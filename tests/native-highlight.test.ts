import { test } from "node:test";
import assert from "node:assert/strict";
import { EditorState, EditorSelection } from "@codemirror/state";
import type { EditorView } from "@codemirror/view";
import { history, undo, redo } from "@codemirror/commands";
import { anchorFilter, annotationState, changeComments } from "../src/editor";
import { editorUX, colorSelection, selectionSession } from "../src/editor-ui";
import { canUseNative } from "../src/native-highlight";
import { parse, serialize, newComment, mutate, reconcile } from "../src/model";
function fixture(raw = "Make a little room.\n", from = 7, to = 18) {
  let state = EditorState.create({
    doc: raw,
    selection: EditorSelection.single(from, to),
    extensions: [anchorFilter, editorUX(() => "Me"), history()],
  });
  const view = {
    get state() {
      return state;
    },
    dispatch(spec: any) {
      state = state.update(spec).state;
    },
  } as EditorView;
  return {
    view,
    parsed: () => parse(state.doc.toString()),
    state: () => state,
  };
}
test("new ordinary highlights use native syntax; recolor, notes, undo and redo keep one identity", () => {
  const { view, parsed, state } = fixture();
  const id = colorSelection(view, "blue", "Me");
  assert.equal(parsed().document, "Make a ==🔵little room==.\n");
  assert.equal(parsed().records[0].native, true);
  assert.equal(parsed().records[0].target.quote, "little room");
  assert.equal(
    state().sliceDoc(state().selection.main.from, state().selection.main.to),
    "little room",
  );
  colorSelection(view, "green", "Me");
  assert.equal(parsed().document, "Make a ==🟢little room==.\n");
  assert.equal(parsed().records.length, 1);
  assert.equal(parsed().records[0].id, id);
  changeComments(view, (rs) =>
    rs.map((c) => ({ ...c, body: "Remember this" })),
  );
  assert.equal(parsed().records[0].body, "Remember this");
  assert.ok(undo(view));
  assert.equal(parsed().records[0].body, "");
  assert.ok(undo(view));
  assert.equal(parsed().records[0].color, "blue");
  assert.ok(undo(view));
  assert.equal(view.state.doc.toString(), "Make a little room.\n");
  assert.ok(redo(view));
  assert.equal(parsed().records[0].id, id);
});
test("resolved/deleted native highlights remove only owned delimiters, reopening restores them", () => {
  const { view, parsed } = fixture();
  colorSelection(view, "purple", "Me");
  changeComments(view, (rs) => rs.map((c) => ({ ...c, status: "resolved" })));
  assert.equal(parsed().document, "Make a little room.\n");
  assert.equal(parsed().records[0].target.quote, "little room");
  changeComments(view, (rs) => rs.map((c) => ({ ...c, status: "open" })));
  assert.equal(parsed().document, "Make a ==🟣little room==.\n");
  changeComments(view, () => []);
  assert.equal(view.state.doc.toString(), "Make a little room.\n");
});
test("atomic Reading-view mutations update syntax, anchors and note metadata together", () => {
  const { view } = fixture();
  colorSelection(view, "red", "Me");
  let raw = mutate(view.state.doc.toString(), (rs) =>
    rs.map((c) => ({ ...c, color: "orange", body: "Reading note" })),
  );
  assert.equal(parse(raw).document, "Make a ==🟠little room==.\n");
  assert.equal(parse(raw).records[0].body, "Reading note");
  raw = mutate(raw, () => []);
  assert.equal(raw, "Make a little room.\n");
});
test("native edits outside the pill update color; removing markers retains a detached note", () => {
  const { view, parsed } = fixture();
  colorSelection(view, "blue", "Me");
  changeComments(view, (rs) => rs.map((c) => ({ ...c, body: "Keep me" })));
  view.dispatch({ changes: { from: 9, to: 11, insert: "🟠" } });
  assert.equal(parsed().records[0].color, "orange");
  assert.equal(view.state.field(annotationState).records[0].color, "orange");
  const c = parsed().records[0];
  view.dispatch({
    changes: [
      { from: 7, to: 11, insert: "" },
      { from: c.target.to, to: c.target.to + 2, insert: "" },
    ],
  });
  assert.equal(parsed().document, "Make a little room.\n");
  assert.equal(parsed().records[0].body, "Keep me");
  assert.equal(parsed().records[0].target.state, "detached");
});
test("external recoloring and moving a native passage reconcile without losing its comment", () => {
  const { view } = fixture();
  colorSelection(view, "blue", "Me");
  const p = parse(view.state.doc.toString());
  const moved = "Intro.\n\n" + p.document.replace("🔵", "🟢");
  const result = reconcile(parse(serialize(moved, p.records)))[0];
  assert.equal(result.color, "green");
  assert.equal(result.target.quote, "little room");
  assert.equal(result.target.state, "attached");
});
test("legacy annotations are never converted, including when recolored or beside a new native highlight", () => {
  const doc = "Old passage. New passage.\n";
  const legacy = newComment(doc, 0, 11, "selection", "Old note", "Me", "blue");
  const { view, parsed } = fixture(serialize(doc, [legacy]), 0, 11);
  colorSelection(view, "red", "Me");
  assert.equal(parsed().document, doc);
  assert.equal(parsed().records[0].native, undefined);
  view.dispatch({ selection: EditorSelection.single(13, 24) });
  colorSelection(view, "green", "Me");
  assert.equal(parsed().records[0].id, legacy.id);
  assert.equal(parsed().records[0].body, legacy.body);
  assert.equal(parsed().records[0].native, undefined);
  assert.equal(parsed().records[0].target.quote, "Old passage");
  assert.equal(parsed().document, "Old passage. ==🟢New passage==.\n");
});
test("unsafe selections use legacy storage, preserving Markdown, code, math, and overlapping ranges", () => {
  const cases = [
    "`some code`",
    "$some math$",
    "[some link](https://example.com)",
    "==🔵some text==",
    "```\nsome code\n```",
    "$$\nsome math\n$$",
    "---\nname: some text\n---",
    "first\n\nsecond",
    "    some code",
  ];
  for (const raw of cases) {
    const from = raw.includes("some") ? raw.indexOf("some") : 0,
      to = raw.includes("some") ? from + 4 : raw.length;
    const { view, parsed } = fixture(raw, from, to);
    colorSelection(view, "blue", "Me");
    assert.equal(parsed().document, raw, raw);
    assert.equal(parsed().records[0].native, undefined, raw);
  }
  assert.equal(canUseNative("==🟡one== and two", 4, 7, []), false);
});
test("a second separate native highlight on the same line keeps both identities", () => {
  const { view, parsed } = fixture("one and two", 0, 3);
  colorSelection(view, "blue", "Me");
  const from = parsed().document.indexOf("two");
  view.dispatch({ selection: EditorSelection.single(from, from + 3) });
  colorSelection(view, "green", "Me");
  assert.equal(parsed().document, "==🔵one== and ==🟢two==");
  assert.equal(parsed().records.length, 2);
  assert.ok(parsed().records.every((c) => c.native));
  assert.equal(
    view.state.field(selectionSession)?.highlightId,
    parsed().records[1].id,
  );
});

test("older hosts keep the existing highlight format", () => {
  let state = EditorState.create({
    doc: "ordinary text",
    selection: EditorSelection.single(0, 8),
    extensions: [anchorFilter, editorUX(() => "Me", undefined, false, false)],
  });
  const view = {
    get state() {
      return state;
    },
    dispatch(spec: any) {
      state = state.update(spec).state;
    },
  } as EditorView;
  colorSelection(view, "blue", "Me");
  assert.equal(parse(state.doc.toString()).document, "ordinary text");
  assert.equal(parse(state.doc.toString()).records[0].native, undefined);
});

test("bulk resolution and deletion update native markers while preserving unselected annotations", () => {
  const { view, parsed } = fixture(
    "First phrase. Second phrase. Third phrase.\n",
    0,
    12,
  );
  const first = colorSelection(view, "blue", "Me")!;
  for (const [quote, color] of [
    ["Second phrase", "green"],
    ["Third phrase", "orange"],
  ] as const) {
    const from = view.state.doc.toString().indexOf(quote);
    view.dispatch({
      selection: EditorSelection.single(from, from + quote.length),
    });
    colorSelection(view, color, "Me");
  }
  const records = parsed().records;
  assert.equal(records.length, 3);
  const ids = new Set([first, records[1].id]);
  const original = parsed();
  let raw = mutate(view.state.doc.toString(), (rs) =>
    rs.map((c) => (ids.has(c.id) ? { ...c, status: "resolved" } : c)),
  );
  assert.equal(
    parse(raw).document,
    "First phrase. Second phrase. ==🟠Third phrase==.\n",
  );
  raw = mutate(raw, (rs) =>
    rs.map((c) => (ids.has(c.id) ? { ...c, status: "open" } : c)),
  );
  assert.equal(parse(raw).document, original.document);
  raw = mutate(raw, (rs) => rs.filter((c) => !ids.has(c.id)));
  assert.equal(
    parse(raw).document,
    "First phrase. Second phrase. ==🟠Third phrase==.\n",
  );
  assert.equal(parse(raw).records.length, 1);
  assert.equal(parse(raw).records[0].id, records[2].id);
  assert.equal(parse(raw).records[0].target.quote, "Third phrase");
});
