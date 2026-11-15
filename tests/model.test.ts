import { test } from "node:test";
import assert from "node:assert/strict";
import { EditorState } from "@codemirror/state";
import { history, undo, redo } from "@codemirror/commands";
import { anchorFilter } from "../src/editor";
import {
  anchor,
  locate,
  mutate,
  newComment,
  parse,
  reconcile,
  serialize,
  unitRange,
} from "../src/model";
const doc = "# Draft\n\nAlpha **bold** and 🌙 café.\n\nBeta sentence.\n";
const make = (text = doc, quote = "bold") =>
  newComment(
    text,
    text.indexOf(quote),
    text.indexOf(quote) + quote.length,
    "selection",
    "Review <script>alert(1)</script> --> & details",
    "Ada",
    "blue",
  );
const state = (text = doc, c = make(text)) =>
  EditorState.create({
    doc: serialize(text, [c]),
    extensions: [anchorFilter, history()],
  });
test("footer roundtrip preserves exact document and safely escapes HTML terminators", () => {
  const c = make(),
    raw = serialize(doc, [c]);
  assert.equal(parse(raw).document, doc);
  assert.deepEqual(parse(raw).records, [c]);
  assert.equal(raw.includes("<script>"), false);
  assert.equal(raw.match(/-->/g)?.length, 1);
});
test("lifecycle operations and last deletion preserve unrelated bytes", () => {
  let raw = serialize(doc, [make()]);
  raw = mutate(raw, (rs) =>
    rs.map((c) => ({ ...c, status: "resolved", body: "Edited" })),
  );
  assert.equal(parse(raw).records[0].status, "resolved");
  raw = mutate(raw, (rs) => rs.map((c) => ({ ...c, status: "open" })));
  assert.equal(parse(raw).records[0].status, "open");
  assert.equal(
    mutate(raw, () => []),
    doc,
  );
});
test("reject malformed, unsupported, duplicate footers, duplicate IDs and trailing text without writes", () => {
  for (const raw of [
    doc + "\n<!-- obsidian-comments:v2\n{}\n-->\n",
    doc + "\n<!-- obsidian-comments:v1\n{}\n-->\n",
    serialize(doc, [make()]) + "suffix",
    serialize(doc, [make()]) + serialize("", [make()]),
  ]) {
    assert.ok(parse(raw).error);
    assert.throws(() => mutate(raw, () => []));
  }
  const c = make();
  assert.throws(() => serialize(doc, [c, c]));
});
test("external move follows unique quote; duplicate quote without context detaches", () => {
  const c = make();
  assert.equal(locate("Intro\n" + doc, c).target.from, c.target.from + 6);
  assert.equal(locate("Moved bold elsewhere", c).target.state, "detached");
  assert.equal(locate("bold x bold", c).target.state, "detached");
  assert.equal(locate("deleted", c).target.state, "detached");
});
test("context disambiguates repeated passages and ignores stale offsets", () => {
  const text = "one repeated two\nthree repeated four";
  const c = make(text, "repeated");
  const moved = "PREFIX\n" + text;
  assert.equal(locate(moved, c).target.from, moved.indexOf("repeated"));
  assert.equal(locate("repeated repeated", c).target.state, "detached");
});
test("typing before and inside target maps range and quote in same transaction", () => {
  let s = state();
  s = s.update({ changes: { from: 0, insert: "Intro\n" } }).state;
  let p = parse(s.doc.toString());
  assert.equal(p.records[0].target.from, p.document.indexOf("bold"));
  const at = p.records[0].target.from + 2;
  s = s.update({ changes: { from: at, insert: "NEW" } }).state;
  p = parse(s.doc.toString());
  assert.equal(p.records[0].target.quote, "boNEWld");
  assert.equal(p.records[0].target.originalQuote, "bold");
});
test("deletion preserves record and marks target detached", () => {
  let s = state();
  const c = parse(s.doc.toString()).records[0];
  s = s.update({ changes: { from: c.target.from, to: c.target.to } }).state;
  assert.equal(parse(s.doc.toString()).records[0].target.state, "detached");
});
test("overlaps survive independent edits and Unicode positions", () => {
  const a = make(doc, "bold"),
    b = make(doc, "**bold** and 🌙");
  let s = EditorState.create({
    doc: serialize(doc, [a, b]),
    extensions: [anchorFilter],
  });
  s = s.update({
    changes: { from: doc.indexOf("bold") + 2, insert: "é" },
  }).state;
  const p = parse(s.doc.toString());
  assert.equal(p.records.length, 2);
  for (const c of p.records)
    assert.equal(p.document.slice(c.target.from, c.target.to), c.target.quote);
});
test("undo and redo restore source AND anchors", () => {
  let s = state();
  const original = s.doc.toString();
  s = s.update({
    changes: { from: doc.indexOf("bold") + 2, insert: "NEW" },
    annotations: [],
  }).state;
  const edited = s.doc.toString();
  const target = {
    get state() {
      return s;
    },
    dispatch: (tr: any) => {
      s = tr.state;
    },
  };
  assert.ok(undo(target));
  assert.equal(s.doc.toString(), original);
  assert.ok(redo(target));
  assert.equal(s.doc.toString(), edited);
});
test("atomic mutation reads latest body and retains concurrent additions", () => {
  const a = make(),
    b = make(doc, "Beta");
  const raw = serialize(doc, [a, b]);
  const changed = mutate(raw, (rs) =>
    rs.map((c) => (c.id === a.id ? { ...c, status: "resolved" } : c)),
  );
  assert.equal(parse(changed).records.length, 2);
  assert.equal(parse(changed).records[1].id, b.id);
});
test("external edits inside target detach; explicit reattachment preserves original quote", () => {
  const c = make();
  const d = locate(doc.replace("bold", "edited"), c);
  assert.equal(d.target.state, "detached");
  const fixed = { ...d, target: anchor(doc, 0, 7, d.target.originalQuote) };
  assert.equal(fixed.target.originalQuote, "bold");
  assert.equal(fixed.target.state, "attached");
});
test("file, section, lists, code block scopes", () => {
  assert.deepEqual(unitRange(doc, 14, "file"), [0, 0]);
  assert.deepEqual(unitRange(doc, 14, "section"), [0, doc.length]);
  const text = "# A\n\n```md\n# fake\n\ncode\n```\n\n## B\nbody\n\n# C\nend";
  const r = unitRange(text, text.indexOf("code"), "section");
  assert.equal(
    text.slice(...r),
    "# A\n\n```md\n# fake\n\ncode\n```\n\n## B\nbody\n\n",
  );
});
test("footer lifecycle edits have separate undo boundaries from typing", () => {
  let s = state();
  const original = s.doc.toString();
  const p = parse(original);
  const resolved = serialize(
    p.document,
    p.records.map((c) => ({ ...c, status: "resolved" })),
  );
  s = s.update({
    changes: {
      from: p.start,
      to: s.doc.length,
      insert: resolved.slice(p.start),
    },
  }).state;
  s = s.update({ changes: { from: 0, insert: "New text\n" } }).state;
  const target = {
    get state() {
      return s;
    },
    dispatch: (tr: any) => {
      s = tr.state;
    },
  };
  undo(target);
  assert.equal(s.doc.toString(), resolved);
  undo(target);
  assert.equal(s.doc.toString(), original);
});
test("deleting one duplicate cannot redirect its annotation to the remaining unrelated copy", () => {
  const text =
    "Original context: identical phrase. Original ending.\n\nUnrelated context: identical phrase. Other ending.";
  const c = make(text, "identical phrase");
  const changed = text.slice(text.indexOf("Unrelated"));
  assert.equal(locate(changed, c).target.state, "detached");
});
test("external malformed edits never change source via transaction filter", () => {
  const raw = serialize(doc, [make()]).replace('"version": 1', '"version": 2');
  const s = EditorState.create({ doc: raw, extensions: [anchorFilter] });
  const next = s
    .update({ changes: { from: 0, insert: "hello " } })
    .state.doc.toString();
  assert.equal(next, "hello " + raw);
});
test("same-transaction move without preserved context detaches conservatively", () => {
  const text = "Prefix context\n\n" + doc + "\nTail context";
  const c = make(text);
  const from = text.indexOf("Alpha"),
    to = text.indexOf("\n\nBeta");
  const part = text.slice(from, to);
  let s = state(text, c);
  s = s.update({
    changes: [
      { from, to, insert: "" },
      { from: text.length, insert: "\n\n" + part },
    ],
  }).state;
  const p = parse(s.doc.toString());
  assert.equal(p.records[0].target.state, "detached"); // Missing full context is deliberately not guessed.
});
