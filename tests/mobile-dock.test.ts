import { test } from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { EditorState, EditorSelection } from "@codemirror/state";
import { showTooltip, type EditorView } from "@codemirror/view";
import { anchorFilter } from "../src/editor";
import { editorUX } from "../src/editor-ui";
import { mobileSelectionDock } from "../src/mobile-dock";

test("only mobile replaces the selection tooltip with a dock", () => {
  for (const mobile of [false, true]) {
    const state = EditorState.create({
      doc: "Select this text.",
      selection: EditorSelection.single(0, 6),
      extensions: [anchorFilter, editorUX(() => "Me", undefined, mobile)],
    });
    assert.equal(
      state.facet(showTooltip).filter(Boolean).length,
      mobile ? 0 : 1,
    );
  }
});

test("mobile dock follows available viewport and host bars, not the selection; tears down cleanly", () => {
  const host = new JSDOM(
    '<body><div class="workspace-leaf mod-active"><div id="editor"></div></div><div class="mobile-toolbar"></div></body>',
    { pretendToBeVisual: true },
  );
  const { document } = host.window;
  const editor = document.querySelector<HTMLElement>("#editor")!;
  const leaf = editor.parentElement!;
  const bar = document.querySelector<HTMLElement>(".mobile-toolbar")!;
  let width = 390,
    height = 480,
    barTop = 430;
  const rect = (x: number, y: number, w: number, h: number) => ({
    x,
    y,
    left: x,
    top: y,
    right: x + w,
    bottom: y + h,
    width: w,
    height: h,
    toJSON() {},
  });
  leaf.getBoundingClientRect = () => rect(0, 40, width, 804);
  bar.getBoundingClientRect = () => rect(0, barTop, width, barTop ? 50 : 0);
  const viewport = new host.window.EventTarget();
  Object.defineProperties(viewport, {
    width: { get: () => width },
    height: { get: () => height },
    offsetLeft: { value: 0 },
    offsetTop: { value: 0 },
  });
  Object.defineProperty(host.window, "visualViewport", { value: viewport });
  let disconnected = false;
  Object.defineProperty(host.window, "ResizeObserver", {
    value: class {
      observe() {}
      unobserve() {}
      disconnect() {
        disconnected = true;
      }
    },
  });
  const frames = new Map<number, FrameRequestCallback>();
  let next = 0;
  host.window.requestAnimationFrame = (fn) => {
    frames.set(++next, fn);
    return next;
  };
  host.window.cancelAnimationFrame = (id) => {
    frames.delete(id);
  };
  const flush = () => {
    for (const [id, fn] of [...frames]) {
      frames.delete(id);
      fn(0);
    }
  };
  let visible = true,
    created = 0,
    destroyed = 0;
  const view = { dom: editor } as unknown as EditorView;
  const plugin = mobileSelectionDock(
    () => visible,
    () => {
      created++;
      const dom = document.createElement("div");
      dom.className = "comments-selection-tooltip";
      dom.appendChild(document.createElement("button"));
      return {
        dom,
        destroy: () => {
          destroyed++;
        },
      };
    },
  );
  const instance = plugin.create(view);
  flush();
  const dock = document.querySelector<HTMLElement>(".comments-mobile-dock")!;
  assert.equal(dock.parentElement, document.body);
  assert.equal(dock.style.getPropertyValue("--comments-dock-bottom"), "430px");
  const pointer = new host.window.Event("pointerdown", {
    bubbles: true,
    cancelable: true,
  });
  dock.querySelector("button")!.dispatchEvent(pointer);
  assert.equal(pointer.defaultPrevented, true);
  instance.update({} as any);
  flush();
  assert.equal(created, 1);
  assert.equal(dock.style.getPropertyValue("--comments-dock-bottom"), "430px");
  height = 350;
  barTop = 300;
  viewport.dispatchEvent(new host.window.Event("resize"));
  flush();
  assert.equal(dock.style.getPropertyValue("--comments-dock-bottom"), "300px");
  height = 844;
  barTop = 0;
  viewport.dispatchEvent(new host.window.Event("resize"));
  flush();
  assert.equal(dock.style.getPropertyValue("--comments-dock-bottom"), "844px");
  width = 844;
  height = 390;
  viewport.dispatchEvent(new host.window.Event("resize"));
  flush();
  assert.equal(dock.style.getPropertyValue("--comments-dock-width"), "844px");
  assert.equal(dock.style.getPropertyValue("--comments-dock-bottom"), "390px");
  leaf.classList.remove("mod-active");
  document.dispatchEvent(new host.window.Event("focusin"));
  flush();
  assert.equal(dock.isConnected, false);
  leaf.classList.add("mod-active");
  instance.update({} as any);
  flush();
  assert.equal(created, 2);
  visible = false;
  instance.update({} as any);
  assert.equal(document.querySelector(".comments-mobile-dock"), null);
  assert.equal(destroyed, 2);
  viewport.dispatchEvent(new host.window.Event("resize"));
  instance.destroy();
  flush();
  assert.equal(disconnected, true);
  viewport.dispatchEvent(new host.window.Event("resize"));
  assert.equal(frames.size, 0);
  host.window.close();
});
