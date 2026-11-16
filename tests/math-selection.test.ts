import { test } from "node:test";
import assert from "node:assert/strict";
import { EditorState, EditorSelection } from "@codemirror/state";
import type { EditorView } from "@codemirror/view";
import { JSDOM } from "jsdom";
import { anchorFilter, annotationState } from "../src/editor";
import { colorSelection, editorUX, selectionSession } from "../src/editor-ui";
import {
  mathSourceRange,
  renderedMathSelection,
  selectRenderedMath,
} from "../src/math-selection";

const source = "# Note\n\n$E=mc^2$\n";
function state() {
  return EditorState.create({
    doc: source,
    extensions: [anchorFilter, editorUX(() => "Me")],
  });
}

test("rendered math annotations use source ranges without exposing the TeX", () => {
  let current = state().update({
    selection: EditorSelection.single(0, 3),
  }).state;
  current = current.update({
    selection: EditorSelection.single(3),
    effects: selectRenderedMath.of({ from: 8, to: 16 }),
  }).state;
  const view = {
    get state() {
      return current;
    },
    dispatch(spec: Parameters<EditorState["update"]>[0]) {
      current = current.update(spec).state;
    },
  } as unknown as EditorView;
  const id = colorSelection(view, "blue", "Ada");
  assert.equal(current.selection.main.empty, true);
  assert.deepEqual(current.field(renderedMathSelection), { from: 8, to: 16 });
  const record = current.field(annotationState).records[0];
  assert.equal(record.target.quote, "$E=mc^2$");
  assert.equal(record.author, "Ada");
  assert.equal(record.color, "blue");
  assert.equal(current.field(selectionSession)?.highlightId, id);
  colorSelection(view, "green", "Ada");
  assert.equal(current.field(annotationState).records.length, 1);
  assert.equal(current.field(annotationState).records[0].id, id);
  assert.equal(current.field(annotationState).records[0].color, "green");
});

test("source edits and editor selections clear rendered math targets", () => {
  const selected = state().update({
    effects: selectRenderedMath.of({ from: 8, to: 16 }),
  }).state;
  const edited = selected.update({
    changes: { from: 0, insert: "prefix" },
  }).state;
  assert.equal(edited.field(renderedMathSelection), null);
  assert.equal(edited.field(selectionSession), null);
  const cursor = selected.update({
    selection: EditorSelection.single(0),
  }).state;
  assert.equal(cursor.field(renderedMathSelection), null);
});

test("read-only and malformed notes do not expose rendered math controls", () => {
  for (const current of [
    EditorState.create({
      doc: source,
      extensions: [
        anchorFilter,
        editorUX(() => "Me"),
        EditorState.readOnly.of(true),
      ],
    }),
    EditorState.create({
      doc: source + "\n<!-- obsidian-comments:v1\nnot JSON\n-->",
      extensions: [anchorFilter, editorUX(() => "Me")],
    }),
  ]) {
    const next = current.update({
      effects: selectRenderedMath.of({ from: 8, to: 16 }),
    }).state;
    assert.equal(next.field(renderedMathSelection), null);
    assert.equal(next.field(selectionSession), null);
  }
});

test("widget bounds identify repeated equations locally and omit trailing block whitespace", () => {
  const dom = new JSDOM("<div><span></span><span class='math'></span></div>");
  const root = dom.window.document.querySelector("div")!;
  const math = root.querySelector<HTMLElement>(".math")!;
  let doc = "$x$ then $x$";
  let from = 9,
    to = 12;
  const view = {
    contentDOM: root,
    get state() {
      return EditorState.create({ doc });
    },
    posAtDOM(node: Node, offset: number) {
      assert.equal(node, root);
      assert.ok(offset === 1 || offset === 2);
      return offset === 1 ? from : to;
    },
  } as unknown as EditorView;
  assert.deepEqual(mathSourceRange(view, math), { from: 9, to: 12 });
  doc = "$$\nx^2\n$$\n\n";
  from = 0;
  to = doc.length;
  math.classList.add("math-block");
  assert.deepEqual(mathSourceRange(view, math), { from: 0, to: 9 });
  doc = "unrelated source";
  to = doc.length;
  assert.equal(mathSourceRange(view, math), null);
  dom.window.close();
});
