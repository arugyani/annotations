import { test } from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { EditorState, EditorSelection } from "@codemirror/state";
import { showTooltip, type EditorView } from "@codemirror/view";
import { anchorFilter, annotationState } from "../src/editor";
import { editorUX, composeSelection } from "../src/editor-ui";
import { readAuthor } from "../src/settings";

test("settings reject malformed synced data and preserve a valid author", () => {
  for (const value of [
    null,
    undefined,
    [],
    {},
    "Ada",
    { author: 42 },
    { author: {} },
    { author: "  " },
  ])
    assert.equal(readAuthor(value), "Me");
  assert.equal(readAuthor({ author: "  Ada  " }), "Ada");
});

test("the inline editor belongs to its pop-out document and saves user text literally", () => {
  const popout = new JSDOM("<!doctype html><body></body>");
  const document = popout.window.document;
  let state = EditorState.create({
    doc: "A little context.\n",
    extensions: [anchorFilter, editorUX(() => "Me")],
    selection: EditorSelection.single(2, 8),
  });
  const view = {
    get state() {
      return state;
    },
    dom: document.createElement("div"),
    focus() {},
    requestMeasure() {},
    dispatch(spec: any) {
      state = state.update(spec).state;
      tip.update?.({ state } as any);
    },
  } as unknown as EditorView;
  const descriptor = state.facet(showTooltip).find(Boolean)!;
  const tip = descriptor.create(view);
  document.body.appendChild(tip.dom);
  tip.mount?.(view);
  assert.equal(tip.dom.ownerDocument, document);
  assert.equal(tip.dom.querySelectorAll("button").length, 6);
  const colors =
    tip.dom.querySelectorAll<HTMLButtonElement>(".comments-swatch");
  colors[1].click();
  assert.equal(state.field(annotationState).records[0].body, "");
  view.dispatch({ effects: composeSelection.of(true) });
  const textarea = tip.dom.querySelector("textarea")!;
  assert.equal(textarea.ownerDocument, document);
  const save = Array.from(tip.dom.querySelectorAll("button")).find(
    (b) => b.textContent === "Save note",
  )!;
  assert.equal(save.disabled, true);
  const text = "<script>window.injected=true</script> -->";
  textarea.value = text;
  textarea.dispatchEvent(new popout.window.Event("input"));
  assert.equal(save.disabled, false);
  save.click();
  assert.equal(state.field(annotationState).records.length, 1);
  assert.equal(state.field(annotationState).records[0].body, text);
  assert.equal(tip.dom.querySelector("script"), null);
  assert.equal(tip.dom.querySelector("textarea"), null);
  tip.destroy?.();
  popout.window.close();
});
