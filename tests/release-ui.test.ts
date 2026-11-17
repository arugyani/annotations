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

test("the inline editor belongs to its pop-out document and saves user text literally", (t) => {
  const popout = new JSDOM("<!doctype html><body></body>");
  const document = popout.window.document;
  // Model the host helpers in a different document to exercise adoption.
  const main = new JSDOM("<!doctype html><body></body>");
  const proto = main.window.Node.prototype as unknown as Node;
  proto.createEl = function (tag) {
    const el = this.ownerDocument!.createElement(tag);
    this.appendChild(el);
    return el;
  };
  proto.createDiv = function () {
    return this.createEl("div");
  };
  proto.createSpan = function () {
    return this.createEl("span");
  };
  proto.createSvg = function (tag) {
    const el = this.ownerDocument!.createElementNS(
      "http://www.w3.org/2000/svg",
      tag,
    );
    this.appendChild(el);
    return el;
  };
  const popoutProto = popout.window.Node.prototype as unknown as Node;
  popoutProto.createEl = proto.createEl;
  popoutProto.createDiv = proto.createDiv;
  popoutProto.createSpan = proto.createSpan;
  popoutProto.createSvg = proto.createSvg;
  const original = Object.getOwnPropertyDescriptor(globalThis, "createDiv");
  Object.defineProperty(globalThis, "createDiv", {
    configurable: true,
    value: () => main.window.document.createElement("div"),
  });
  t.after(() => {
    if (original) Object.defineProperty(globalThis, "createDiv", original);
    else Reflect.deleteProperty(globalThis, "createDiv");
  });
  t.after(() => main.window.close());
  let state = EditorState.create({
    doc: "A little context.\n",
    extensions: [anchorFilter, editorUX(() => "Me")],
    selection: EditorSelection.single(2, 8),
  });
  let positioning = false;
  const editorDOM = document.createElement("div");
  editorDOM.getBoundingClientRect = () =>
    new popout.window.DOMRect(0, 80, 500, 300);
  const view = {
    get state() {
      return state;
    },
    dom: editorDOM,
    scrollDOM: editorDOM,
    scaleY: 1,
    coordsAtPos() {
      assert.equal(positioning, false, "layout reads belong to the read phase");
      return { top: 204, bottom: 228, left: 100, right: 160 };
    },
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
  // The old window-relative position fits the window but is clipped by the
  // editor's 80px top edge. Positioning must use the cached selection geometry.
  tip.dom.getBoundingClientRect = () =>
    new popout.window.DOMRect(100, 0, 310, 196);
  tip.dom.style.top = "-80px";
  tip.getCoords?.(2);
  positioning = true;
  tip.positioned?.({ top: 0, left: 0, right: 500, bottom: 380 });
  positioning = false;
  assert.equal(tip.dom.style.top, "8px");
  assert.equal(
    tip.dom.style.getPropertyValue("--comments-popup-max-height"),
    "284px",
  );
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
