import { test } from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { ReadingAnnotationControls } from "../src/reading-controls";
import { newComment } from "../src/model";

for (const mobile of [false, true])
  test(`Reading-view controls (${mobile ? "mobile" : "desktop"}) keep one annotation, preserve drafts, refuse stale saves, and clean up`, async (t) => {
    const host = new JSDOM(
      '<body><div class="markdown-reading-view"><mark class="comments-highlight" tabindex="0">A passage</mark></div></body>',
      { pretendToBeVisual: true },
    );
    const { document } = host.window;
    const proto = host.window.Node.prototype as unknown as Node;
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
    const previous = Object.getOwnPropertyDescriptor(globalThis, "createDiv");
    Object.defineProperty(globalThis, "createDiv", {
      configurable: true,
      value: () => document.createElement("div"),
    });
    t.after(() => {
      if (previous) Object.defineProperty(globalThis, "createDiv", previous);
      else Reflect.deleteProperty(globalThis, "createDiv");
      host.window.close();
    });
    let disconnected = 0;
    Object.defineProperty(host.window, "ResizeObserver", {
      value: class {
        observe() {}
        disconnect() {
          disconnected++;
        }
      },
    });
    const mark = document.querySelector<HTMLElement>("mark")!;
    let records = [
      newComment("A passage", 0, 9, "selection", "Existing note", "Me", "blue"),
    ];
    mark.dataset.commentId = records[0].id;
    const id = records[0].id;
    let closed = false;
    const popup = new ReadingAnnotationControls(
      mark,
      records[0],
      async (fn) => {
        records = fn(records);
        return true;
      },
      mobile,
      () => {
        closed = true;
      },
    );
    t.after(() => popup.close());
    if (mobile) {
      const pane = document.querySelector<HTMLElement>(
        ".markdown-reading-view",
      )!;
      pane.getBoundingClientRect = () =>
        new host.window.DOMRect(0, 40, 390, 728);
      let targetTop = 730;
      mark.getClientRects = () =>
        [
          new host.window.DOMRect(20, targetTop, 120, 24),
        ] as unknown as DOMRectList;
      const dock = document.querySelector<HTMLElement>(
        ".comments-mobile-dock",
      )!;
      dock.getBoundingClientRect = () =>
        new host.window.DOMRect(0, 708, 390, 60);
      const frame = () =>
        new Promise<void>((resolve) =>
          host.window.requestAnimationFrame(() => resolve()),
        );
      await frame();
      assert.ok(dock.classList.contains("is-docked-top"));
      assert.equal(dock.style.getPropertyValue("--comments-dock-top"), "40px");
      targetTop = 180;
      host.window.dispatchEvent(new host.window.Event("resize"));
      await frame();
      assert.ok(
        dock.classList.contains("is-docked-top"),
        "Reading controls stay at the same edge for this highlight",
      );
    }

    const button = (label: string) =>
      document.querySelector<HTMLButtonElement>(
        `button[aria-label="${label}"]`,
      )!;
    const text = () => document.querySelector("textarea")!;
    const settle = () => new Promise<void>((resolve) => setImmediate(resolve));
    button("Edit note").click();
    assert.equal(text().value, "Existing note");
    text().value = "A draft";
    text().dispatchEvent(new host.window.Event("input"));
    button("Highlight purple").click();
    await settle();
    assert.equal(records.length, 1);
    assert.equal(records[0].id, id);
    assert.equal(records[0].color, "purple");
    assert.ok(mark.classList.contains("comments-purple"));
    assert.equal(text().value, "A draft");
    const save = () =>
      Array.from(document.querySelectorAll("button")).find(
        (b) => b.textContent === "Save note",
      )!;
    save().click();
    await settle();
    assert.equal(records[0].body, "A draft");
    assert.equal(document.querySelector("textarea"), null);
    button("Edit note").click();
    text().value = "Local edit";
    text().dispatchEvent(new host.window.Event("input"));
    records = records.map((c) => ({ ...c, body: "External edit" }));
    popup.refresh(records[0]);
    save().click();
    await settle();
    assert.equal(records[0].body, "External edit");
    assert.equal(text().value, "Local edit");
    assert.match(
      document.querySelector('[role="alert"]')!.textContent!,
      /changed/,
    );
    document.body.dispatchEvent(
      new host.window.Event("pointerdown", { bubbles: true }),
    );
    assert.equal(closed, true);
    assert.equal(disconnected, 1);
    assert.equal(document.querySelector(".comments-reading-controls"), null);
    popup.refresh(records[0]);
    host.window.dispatchEvent(new host.window.Event("resize"));
    assert.equal(document.querySelector(".comments-reading-controls"), null);
  });
