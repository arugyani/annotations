import { test } from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { NativeHighlightPresentation } from "../src/native-highlight-presentation";

test("native presentation marks only owned syntax, follows reused DOM, and cleans up", async () => {
  const host = new JSDOM('<div id="editor"></div>', {
    pretendToBeVisual: true,
  });
  const root = host.window.document.querySelector<HTMLElement>("#editor")!;
  const html = (owned: boolean) =>
    `<span class="cm-formatting-highlight">==</span><img class="cm-widgetBuffer"><span class="cm-highlight-color-widget">blue</span><img class="cm-widgetBuffer"><span class="cm-highlight"><span class="${owned ? "comments-native" : "other"}">passage</span></span><span class="cm-formatting-highlight cm-formatting-highlight-end">==</span>`;
  root.innerHTML = `<div id="owned">${html(true)}</div><div id="unrelated">${html(false)}</div>`;
  const frames = new Map<number, FrameRequestCallback>();
  let id = 0;
  host.window.requestAnimationFrame = (fn) => {
    frames.set(++id, fn);
    return id;
  };
  host.window.cancelAnimationFrame = (key) => {
    frames.delete(key);
  };
  const flush = async () => {
    await Promise.resolve();
    for (const [key, fn] of [...frames]) {
      frames.delete(key);
      fn(0);
    }
    await Promise.resolve();
  };
  const presentation = new NativeHighlightPresentation(root);
  await flush();
  assert.equal(root.querySelectorAll(".comments-native-surface").length, 1);
  assert.equal(root.querySelectorAll(".comments-native-syntax").length, 3);
  assert.equal(
    root.querySelectorAll("#unrelated .comments-native-syntax").length,
    0,
  );
  assert.equal(frames.size, 0, "own mutations do not schedule another pass");
  root.querySelector(".comments-native")!.classList.remove("comments-native");
  await flush();
  assert.equal(
    root.querySelectorAll(".comments-native-syntax,.comments-native-surface")
      .length,
    0,
  );
  root.querySelector("#owned")!.innerHTML = html(true);
  await flush();
  assert.equal(root.querySelectorAll(".comments-native-syntax").length, 3);
  presentation.schedule();
  presentation.destroy();
  assert.equal(frames.size, 0);
  assert.equal(
    root.querySelectorAll(".comments-native-syntax,.comments-native-surface")
      .length,
    0,
  );
  host.window.close();
});
