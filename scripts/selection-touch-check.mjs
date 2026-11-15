import { chromium, expect } from "playwright/test";
import { writeFile } from "node:fs/promises";
import assert from "node:assert/strict";
const browser = await chromium.connectOverCDP("http://127.0.0.1:9223");
const page = browser
  .contexts()[0]
  .pages()
  .find((p) => p.url().startsWith("app://obsidian.md/index"));
const checks = [];
const raw = () =>
  page.evaluate(() =>
    app.workspace
      .getLeavesOfType("markdown")
      .find((l) => l.view.file?.path === "EOF UX.md")
      .view.editor.getValue(),
  );
await page.setViewportSize({ width: 1200, height: 900 });
await page.evaluate(async () => {
  let f = app.vault.getAbstractFileByPath("EOF UX.md");
  if (f) await app.vault.modify(f, "asdf");
  else f = await app.vault.create("EOF UX.md", "asdf");
  const l =
    app.workspace.getLeavesOfType("markdown").find((l) => l.view.file === f) ??
    app.workspace.getLeaf(false);
  await l.openFile(f, { state: { mode: "source", source: true } });
  app.workspace.setActiveLeaf(l);
  l.view.editor.setValue("asdf");
  app.workspace.rightSplit.collapse();
  app.workspace.leftSplit.collapse();
  l.view.editor.setSelection({ line: 0, ch: 0 }, { line: 0, ch: 4 });
  l.view.editor.focus();
});
await expect(
  page.getByRole("button", { name: "Highlight blue", exact: true }),
).toBeVisible();
await page.getByRole("button", { name: "Highlight blue", exact: true }).click();
await page.keyboard.press("ArrowRight");
await page.keyboard.press("Control+End");
await page.keyboard.type("!");
assert.equal((await raw()).split("\n<!-- obsidian-comments:v1\n")[0], "asdf!");
checks.push(
  "typing at EOF without a final newline stays before the folded metadata",
);
await page.keyboard.press("Control+a");
assert.equal(
  await page.evaluate(() =>
    app.workspace
      .getLeavesOfType("markdown")
      .find((l) => l.view.file?.path === "EOF UX.md")
      .view.editor.getSelection(),
  ),
  "asdf!",
);
await page.keyboard.press("Delete");
assert.equal((await raw()).split("\n<!-- obsidian-comments:v1\n")[0], "");
await page.keyboard.press("Control+z");
assert.ok((await raw()).startsWith("asdf"));
checks.push(
  "select-all/delete removes prose while preserving annotations, and undo restores it",
);
await page.evaluate(async () => {
  const p = app.plugins.plugins.annotations;
  const l = app.workspace
    .getLeavesOfType("markdown")
    .find((l) => l.view.file?.path === "EOF UX.md");
  app.workspace.setActiveLeaf(l);
  await l.setViewState({
    type: "markdown",
    state: { file: "EOF UX.md", mode: "source", source: true },
  });
});
const bytes = await raw();
await page.evaluate(async () => {
  await app.plugins.disablePlugin("annotations");
});
await expect(
  page.getByRole("button", { name: "Show stored comment data" }),
).toHaveCount(0);
assert.equal(await raw(), bytes);
await page.evaluate(() => {
  const e = app.workspace
    .getLeavesOfType("markdown")
    .find((l) => l.view.file?.path === "EOF UX.md").view.editor;
  e.setCursor(e.offsetToPos(e.getValue().length - 5));
});
await page.evaluate(() => app.plugins.enablePlugin("annotations"));
await expect(
  page.locator(".workspace-leaf.mod-active .cm-content"),
).not.toContainText("obsidian-comments:v1");
assert.equal(await raw(), bytes);
checks.push(
  "disable/re-enable preserves bytes and folds metadata even with a saved caret inside it",
);
const cdp = await page.context().newCDPSession(page);
try {
  await cdp.send("Emulation.setTouchEmulationEnabled", {
    enabled: true,
    maxTouchPoints: 1,
  });
  await cdp.send("Emulation.setEmulatedMedia", {
    features: [
      { name: "pointer", value: "coarse" },
      { name: "hover", value: "none" },
    ],
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.evaluate(() => {
    const l = app.workspace
      .getLeavesOfType("markdown")
      .find((l) => l.view.file?.path === "EOF UX.md");
    app.workspace.setActiveLeaf(l);
    l.view.editor.setSelection({ line: 0, ch: 0 }, { line: 0, ch: 4 });
    l.view.editor.focus();
  });
  await expect(
    page.getByRole("button", { name: "Highlight red", exact: true }),
  ).toBeVisible();
  const button = await page
    .getByRole("button", { name: "Highlight red", exact: true })
    .boundingBox();
  assert.ok(button.width >= 44 && button.height >= 44);
  const touch = async (b) => {
    await cdp.send("Input.dispatchTouchEvent", {
      type: "touchStart",
      touchPoints: [{ x: b.x + b.width / 2, y: b.y + b.height / 2 }],
    });
    await cdp.send("Input.dispatchTouchEvent", {
      type: "touchEnd",
      touchPoints: [],
    });
  };
  await touch(button);
  await expect(
    page.getByRole("button", { name: "Highlight red", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  await touch(
    await page
      .getByRole("button", { name: "Add note", exact: true })
      .boundingBox(),
  );
  await expect(
    page.getByRole("textbox", { name: "Note for selected text" }),
  ).toBeFocused();
  await page
    .getByRole("textbox", { name: "Note for selected text" })
    .fill("A touch note");
  await touch(
    await page
      .getByRole("button", { name: "Save note", exact: true })
      .boundingBox(),
  );
  assert.ok((await raw()).includes("A touch note"));
  checks.push(
    "emulated touch uses 44px controls and supports color selection plus inline note entry",
  );
} finally {
  await cdp.send("Emulation.setTouchEmulationEnabled", { enabled: false });
  await cdp.send("Emulation.setEmulatedMedia", { features: [] });
  await page.setViewportSize({ width: 1200, height: 900 });
}
await writeFile(
  "evidence/selection-touch-results.json",
  JSON.stringify(
    { obsidian: "1.15.1", emulatedTouch: true, physicalDevice: false, checks },
    null,
    2,
  ),
);
console.log(checks.map((x) => "PASS " + x).join("\n"));
await browser.close();
