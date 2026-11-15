import { test } from "node:test";
import assert from "node:assert/strict";
import { EditorState, Prec } from "@codemirror/state";
import { history, undo, redo } from "@codemirror/commands";
import { annotationState, anchorFilter, changeComments } from "../src/editor";
import {
  anchor,
  newComment,
  parse,
  locate,
  reconcile,
  serialize,
} from "../src/model";
import type { EditorView } from "@codemirror/view";
const document =
  "# Note\n\nAlpha target phrase and café 🌙.\n\nBeta second paragraph.\n";
const c = () =>
  newComment(
    document,
    document.indexOf("target"),
    document.indexOf("target") + 6,
    "selection",
    "Keep me",
    "Test",
    "blue",
  );
test("hundreds of incremental edits keep cached state and persisted anchors identical", () => {
  const a = c(),
    b = newComment(
      document,
      a.target.from - 6,
      a.target.to + 7,
      "selection",
      "Overlap",
      "Other",
      "yellow",
    );
  let state = EditorState.create({
    doc: serialize(document, [a, b]),
    extensions: [anchorFilter, history()],
  });
  const original = state.doc.toString();
  let seed = 123456;
  const random = () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed;
  };
  for (let i = 0; i < 400; i++) {
    const current = state.field(annotationState),
      from = random() % (current.start + 1),
      to = Math.min(current.start, from + (random() % 5));
    state = state.update({
      changes: { from, to, insert: ["x", "🌙", "\n", "é", ""][random() % 5] },
    }).state;
    const cached = state.field(annotationState),
      stored = parse(state.doc.toString());
    assert.equal(cached.document, stored.document);
    assert.deepEqual(cached.records, stored.records);
    assert.equal(cached.error, undefined);
    for (const record of cached.records)
      if (record.target.state === "attached") {
        const t = record.target;
        assert.equal(cached.document.slice(t.from, t.to), t.quote);
        assert.deepEqual(
          t,
          anchor(cached.document, t.from, t.to, t.originalQuote),
        );
      }
  }
  const edited = state.doc.toString(),
    target = {
      get state() {
        return state;
      },
      dispatch: (tr: any) => {
        state = tr.state;
      },
    };
  while (undo(target)) {}
  assert.equal(state.doc.toString(), original);
  while (redo(target)) {}
  assert.equal(state.doc.toString(), edited);
});
test("typing after all targets and contexts leaves footer bytes untouched", () => {
  const text = document + "z".repeat(10000),
    comment = newComment(text, 0, 6, "selection", "Test", "Me", "yellow");
  const state = EditorState.create({
    doc: serialize(text, [comment]),
    extensions: [anchorFilter],
  });
  const next = state.update({
    changes: { from: text.length, insert: "hello" },
  });
  let ranges = 0;
  next.changes.iterChangedRanges(() => ranges++);
  assert.equal(ranges, 1);
  assert.equal(
    next.state.field(annotationState).footer,
    state.field(annotationState).footer,
  );
});
test("marker detection handles every token split and unbounded Unicode whitespace", () => {
  const token = "<!--" + " \n\t\u2003".repeat(1500) + "obsidian-comments:";
  for (const position of [
    ...Array(4).keys(),
    ...Array.from({ length: 18 }, (_, i) => token.length - 18 + i),
  ]) {
    const broken = token.slice(0, position) + token.slice(position + 1),
      source = "target\n" + broken + "v99";
    if (parse(source).error) continue;
    for (const footer of [false, true]) {
      const raw = footer
        ? serialize(source, [
            newComment(source, 0, 6, "selection", "Preserve", "Me", "red"),
          ])
        : source;
      const state = EditorState.create({
        doc: raw,
        extensions: [anchorFilter],
      });
      const at = 7 + position;
      const expected = raw.slice(0, at) + token[position] + raw.slice(at);
      const next = state.update({
        changes: { from: at, insert: token[position] },
      }).state;
      assert.equal(next.doc.toString(), expected);
      assert.ok(next.field(annotationState).error);
    }
  }
});
test("deletion that joins a malformed marker is validated without rewriting metadata", () => {
  const source = "target\n<!--" + " ".repeat(15000) + "obsidian-Xcomments:v99";
  const raw = serialize(source, [
    newComment(source, 0, 6, "selection", "Preserve", "Me", "blue"),
  ]);
  const state = EditorState.create({ doc: raw, extensions: [anchorFilter] }),
    at = source.indexOf("X");
  const next = state.update({ changes: { from: at, to: at + 1 } }).state;
  assert.ok(next.field(annotationState).error);
  assert.equal(next.doc.toString(), raw.slice(0, at) + raw.slice(at + 1));
});
test("a later editor filter cannot make prepared snapshot data stale", () => {
  const foreign = EditorState.transactionFilter.of((tr) =>
    tr.docChanged
      ? [tr, { changes: { from: 0, insert: "Foreign\n" }, sequential: true }]
      : tr,
  );
  const state = EditorState.create({
    doc: serialize(document, [c()]),
    extensions: [anchorFilter, Prec.high(foreign)],
  });
  const next = state.update({ changes: { from: 2, insert: "x" } }).state;
  assert.equal(
    next.field(annotationState).document,
    parse(next.doc.toString()).document,
  );
  assert.deepEqual(
    next.field(annotationState).records,
    reconcile(parse(next.doc.toString())),
  );
});
test("owned lifecycle actions keep known overlapping/duplicated editor anchors attached", () => {
  const source = document + "tail".repeat(32);
  let state = EditorState.create({
    doc: serialize(source, [
      newComment(
        source,
        document.indexOf("target"),
        document.indexOf("target") + 6,
        "selection",
        "Test",
        "Me",
        "blue",
      ),
    ]),
    extensions: [anchorFilter, history()],
  });
  state = state.update({
    changes: { from: source.length, insert: source },
  }).state;
  const before = state.field(annotationState).records[0];
  assert.equal(before.target.state, "attached");
  const view = {
    get state() {
      return state;
    },
    dispatch: (spec: any) => {
      state = state.update(spec).state;
    },
  } as unknown as EditorView;
  changeComments(view, (records) =>
    records.map((c) => ({ ...c, status: "resolved" })),
  );
  assert.equal(
    state.field(annotationState).records[0].target.state,
    "attached",
  );
  assert.equal(state.field(annotationState).records[0].status, "resolved");
});
test("streamed matching verifies exact signatures despite rolling-hash collisions", () => {
  const prefix = "p".repeat(64),
    suffix = "s".repeat(64),
    quotes = [
      "Aa",
      "BB",
      ...Array.from(
        { length: 90 },
        (_, i) => String.fromCharCode(1000 + i) + "x",
      ),
    ];
  const source =
    "z".repeat(270000) + quotes.map((q) => prefix + q + suffix + "\n").join("");
  const records = quotes.map((q, i) => {
    const at = 270000 + i * 131 + 64;
    return newComment(source, at, at + 2, "selection", "Test", "Me", "green");
  });
  // The 31-based hashes of Aa and BB collide, including with the same prefix/suffix.
  const changed = source + prefix + "Aa" + suffix + "\n";
  const actual = reconcile({
    document: changed,
    records,
    start: changed.length,
  });
  assert.deepEqual(
    actual,
    records.map((c) => locate(changed, c)),
  );
  assert.equal(actual[0].target.state, "detached");
  assert.equal(actual[1].target.state, "attached");
});
test("batched matching agrees with conservative matching after Unicode and context edits", () => {
  const lines = Array.from(
    { length: 5000 },
    (_, i) =>
      `Line ${String(i).padStart(5, "0")}: café 🌙 ${"body ".repeat(12)}\n`,
  );
  const source = lines.join("");
  const records = Array.from({ length: 160 }, (_, i) => {
    const at = source.indexOf(`Line ${String(i * 30).padStart(5, "0")}:`);
    return newComment(source, at, at + 12, "selection", "Test", "Me", "purple");
  });
  for (const changed of [
    "PREFIX\n" + source,
    source.replace("Line 00030:", "Moved content"),
    source + lines.slice(25, 35).join(""),
  ])
    assert.deepEqual(
      reconcile({ document: changed, records, start: changed.length }),
      records.map((c) => locate(changed, c)),
    );
});
