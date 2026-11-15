import { test } from "node:test";
import assert from "node:assert/strict";
import { EditorState, EditorSelection, Transaction } from "@codemirror/state";
import { anchorFilter, annotationState, changeComments } from "../src/editor";
import {
  editorUX,
  footerPresentation,
  storedDataVisible,
  showStoredData,
  selectionSession,
  colorSelection,
  composeSelection,
} from "../src/editor-ui";
import { newComment, serialize, parse } from "../src/model";
import { showTooltip, type EditorView } from "@codemirror/view";
const doc =
  '---\ncoordinates:\n  - "64.96"\n  - "-19.02"\ntype: "[[Country]]"\n---\n\nasdf\n';
const comment = () =>
  newComment(
    doc,
    doc.indexOf("asdf"),
    doc.indexOf("asdf") + 4,
    "selection",
    "Check coordinates",
    "Me",
    "blue",
  );
const extensions = [anchorFilter, editorUX(() => "Me")];
const make = (raw = serialize(doc, [comment()])) =>
  EditorState.create({ doc: raw, extensions });
test("validated metadata is hidden without a placeholder or changing file bytes", () => {
  const raw = serialize(doc, [comment()]),
    s = make(raw);
  let ranges: number[][] = [];
  s.field(footerPresentation).between(0, s.doc.length, (from, to) => {
    ranges.push([from, to]);
  });
  const cursor = s.field(footerPresentation).iter();
  assert.equal(cursor.value?.spec.widget, undefined);
  assert.deepEqual(ranges, [[doc.length + 1, raw.length]]);
  assert.equal(s.doc.toString(), raw);
  assert.equal(s.field(storedDataVisible), false);
});
test("raw inspection is explicit and closing it restores the folded block", () => {
  let s = make();
  s = s.update({
    effects: showStoredData.of(true),
    selection: { anchor: doc.length + 10 },
  }).state;
  assert.equal(s.field(storedDataVisible), true);
  assert.equal(s.selection.main.head, doc.length + 10);
  let ranges: number[][] = [];
  s.field(footerPresentation).between(0, s.doc.length, (a, b) => {
    ranges.push([a, b]);
  });
  assert.deepEqual(ranges, []);
  s = s.update({
    effects: showStoredData.of(false),
    selection: { anchor: doc.length },
  }).state;
  assert.equal(s.field(storedDataVisible), false);
});
test("Ctrl+End/select-all equivalent navigation stays out of the folded footer", () => {
  const s = make();
  const end = s.update({
    selection: EditorSelection.single(s.doc.length),
  }).state;
  assert.equal(end.selection.main.head, doc.length);
  const all = s.update({
    selection: EditorSelection.single(0, s.doc.length),
  }).state;
  assert.equal(all.selection.main.to, doc.length);
  assert.equal(all.field(selectionSession)?.to, doc.length);
});
test("unknown or malformed metadata remains visible and is not rewritten", () => {
  for (const raw of [
    "target\n<!-- obsidian-comments:v99\n{}\n-->",
    "target\n<!-- obsidian-comments:v1\n{broken}\n-->",
  ]) {
    const s = make(raw);
    assert.equal(s.field(footerPresentation).size, 0);
    assert.equal(s.doc.toString(), raw);
    assert.ok(s.field(annotationState).error);
  }
});
test("color selection creates one highlight immediately and recolors it without duplicating", () => {
  let s = make(doc);
  const from = doc.indexOf("asdf");
  s = s.update({ selection: EditorSelection.single(from, from + 4) }).state;
  const view = {
    get state() {
      return s;
    },
    dispatch: (spec: any) => {
      s = s.update(spec).state;
    },
  } as unknown as EditorView;
  const id = colorSelection(view, "purple", "Ada");
  assert.ok(id);
  assert.equal(s.field(annotationState).records.length, 1);
  assert.equal(s.field(annotationState).records[0].body, "");
  colorSelection(view, "green", "Ada");
  assert.equal(s.field(annotationState).records.length, 1);
  assert.equal(s.field(annotationState).records[0].color, "green");
  assert.equal(s.field(annotationState).records[0].id, id);
  assert.equal(parse(s.doc.toString()).document, doc);
  changeComments(view, (records) =>
    records.map((c) => ({ ...c, body: "Check the coordinates." })),
  );
  assert.equal(
    s.field(annotationState).records[0].body,
    "Check the coordinates.",
  );
});
test("pill excludes collapsed, raw-metadata, invalid, and read-only selections", () => {
  assert.equal(make().field(selectionSession), null);
  const s = make().update({
    effects: showStoredData.of(true),
    selection: EditorSelection.single(doc.length + 5, doc.length + 12),
  }).state;
  assert.equal(s.field(selectionSession), null);
  const ro = EditorState.create({
    doc,
    extensions: [extensions, EditorState.readOnly.of(true)],
    selection: EditorSelection.single(0, 4),
  });
  assert.equal(ro.field(selectionSession), null);
});
test("composing survives color changes, and the session closes when text selection collapses", () => {
  const from = doc.indexOf("asdf");
  let s = make(doc).update({
    selection: EditorSelection.single(from, from + 4),
    effects: composeSelection.of(true),
  }).state;
  const view = {
    get state() {
      return s;
    },
    dispatch: (spec: any) => {
      s = s.update(spec).state;
    },
  } as unknown as EditorView;
  colorSelection(view, "red", "Me");
  assert.equal(s.field(selectionSession)?.compose, true);
  s = s.update({ selection: { anchor: from } }).state;
  assert.equal(s.field(selectionSession), null);
});
test("multiple existing annotations are preserved when adding a fresh highlight to their exact range", () => {
  const a = comment(),
    b = { ...comment(), id: "other", body: "Another question" };
  const from = doc.indexOf("asdf");
  let s = make(serialize(doc, [a, b])).update({
    selection: EditorSelection.single(from, from + 4),
  }).state;
  const view = {
    get state() {
      return s;
    },
    dispatch: (spec: any) => {
      s = s.update(spec).state;
    },
  } as unknown as EditorView;
  assert.equal(s.field(selectionSession)?.highlightId, null);
  colorSelection(view, "yellow", "Me");
  assert.equal(s.field(annotationState).records.length, 3);
  assert.deepEqual(
    s
      .field(annotationState)
      .records.slice(0, 2)
      .map((c) => c.body),
    [a.body, b.body],
  );
});
test("an annotation at EOF without a final newline keeps its text selection outside metadata", () => {
  let s = EditorState.create({
    doc: "asdf",
    extensions,
    selection: EditorSelection.single(0, 4),
  });
  const view = {
    get state() {
      return s;
    },
    dispatch: (spec: any) => {
      s = s.update(spec).state;
    },
  } as unknown as EditorView;
  colorSelection(view, "blue", "Me");
  assert.equal(s.field(selectionSession)?.to, 4);
  assert.equal(s.field(annotationState).start, 4);
  s = s.update({ selection: EditorSelection.single(s.doc.length) }).state;
  assert.equal(s.selection.main.head, 4);
  s = s.update({ changes: { from: 4, insert: "!" } }).state;
  assert.equal(parse(s.doc.toString()).document, "asdf!");
  assert.equal(parse(s.doc.toString()).records[0].target.quote, "asdf");
});

test("forward-delete cannot remove folded storage, while external edits still reach the validator", () => {
  const s = make().update({ selection: { anchor: doc.length } }).state;
  const guarded = s.update({
    changes: { from: doc.length, to: doc.length + 1 },
    annotations: Transaction.userEvent.of("delete.forward"),
  }).state;
  assert.equal(guarded.doc.toString(), s.doc.toString());
  const external = s.update({
    changes: { from: doc.length, to: doc.length + 1 },
  }).state;
  assert.equal(external.doc.length, s.doc.length - 1);
});

test("selection pill appears on the first selected character and reuses its view as selection grows", () => {
  let state = make(doc).update({
    selection: EditorSelection.single(0, 1),
  }).state;
  const first = state.facet(showTooltip).find(Boolean);
  assert.ok(first);
  assert.equal(first.end, 1);
  state = state.update({ selection: EditorSelection.single(0, 12) }).state;
  const extended = state.facet(showTooltip).find(Boolean);
  assert.equal(extended?.end, 12);
  assert.equal(extended?.create, first.create);
  state = state.update({ selection: EditorSelection.single(0) }).state;
  assert.equal(state.facet(showTooltip).filter(Boolean).length, 0);
});

test("upward and downward selection keep the pill at the fixed end, away from the drag path", () => {
  for (const [anchor, heads, above] of [
    [doc.length, [doc.length - 1, doc.length - 5, 4], false],
    [0, [1, 5, doc.length], true],
  ] as const) {
    let state = make(doc),
      create: unknown;
    for (const head of heads) {
      state = state.update({
        selection: EditorSelection.single(anchor, head),
      }).state;
      const pill = state.facet(showTooltip).find(Boolean);
      assert.ok(pill);
      assert.equal(pill.pos, anchor);
      assert.equal(pill.above, above);
      if (create) assert.equal(pill.create, create);
      create = pill.create;
      const session = state.field(selectionSession)!;
      assert.equal(session.from, Math.min(anchor, head));
      assert.equal(session.to, Math.max(anchor, head));
    }
  }
});
