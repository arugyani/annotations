import { chromium, expect } from "playwright/test";
import { readFile, writeFile } from "node:fs/promises";
import assert from "node:assert/strict";
const browser = await chromium.connectOverCDP("http://127.0.0.1:9223");
const page = browser
  .contexts()[0]
  .pages()
  .find((p) => p.url().startsWith("app://obsidian.md/index"));
const errors = [];
page.on("pageerror", (e) => errors.push(String(e)));
const checks = [];
const pass = (name) => {
  checks.push(name);
  console.log("PASS", name);
};
const doc =
  '---\ncoordinates:\n  - "64.96"\n  - "-19.02"\ntype: "[[Country]]"\n---\n\nasdf\n\nA longer paragraph to test a selection with an optional note.\n';
const api = (fn) => page.evaluate(fn);
await page.setViewportSize({ width: 1200, height: 900 });
await page.evaluate(async (doc) => {
  let f = app.vault.getAbstractFileByPath("Selection UX.md");
  if (f) await app.vault.modify(f, doc);
  else f = await app.vault.create("Selection UX.md", doc);
  const l =
    app.workspace.getLeavesOfType("markdown").find((l) => l.view.file === f) ??
    app.workspace.getLeaf("tab");
  await l.openFile(f, { state: { mode: "source", source: false } });
  app.workspace.setActiveLeaf(l);
  l.view.editor.setValue(doc);
  app.workspace.leftSplit.collapse();
  app.workspace.rightSplit.collapse();
  l.view.editor.setCursor({ line: 8, ch: 0 });
  l.view.editor.focus();
}, doc);
const raw = () =>
  api(() =>
    app.workspace
      .getLeavesOfType("markdown")
      .find((l) => l.view.file?.path === "Selection UX.md")
      .view.editor.getValue(),
  );
const metadata = async () =>
  JSON.parse(
    (await raw()).split("\n<!-- obsidian-comments:v1\n")[1].split("\n-->")[0],
  );
const select = async (text) =>
  page.evaluate((text) => {
    const l = app.workspace
      .getLeavesOfType("markdown")
      .find((l) => l.view.file?.path === "Selection UX.md");
    app.workspace.setActiveLeaf(l);
    const e = l.view.editor,
      at = e.getValue().indexOf(text);
    e.focus();
    e.setSelection(e.offsetToPos(at), e.offsetToPos(at + text.length));
    e.scrollIntoView(
      { from: e.offsetToPos(at), to: e.offsetToPos(at + text.length) },
      true,
    );
  }, text);
const line = page
  .locator(".workspace-leaf.mod-active .cm-content .cm-line")
  .filter({ hasText: /^asdf$/ });
await expect(line).toBeVisible();
const rect = await line.evaluate((el) => {
  const r = document.createRange();
  r.selectNodeContents(el);
  const b = r.getBoundingClientRect();
  return { x: b.x, y: b.y, width: b.width, height: b.height };
});
await page.mouse.move(rect.x + 1, rect.y + rect.height / 2);
await page.mouse.down();
await page.mouse.move(rect.x + rect.width - 1, rect.y + rect.height / 2, {
  steps: 8,
});
await page.mouse.up();
await expect(
  page.getByRole("toolbar", { name: "Annotate selection" }),
).toBeVisible();
assert.equal(
  await api(() =>
    app.workspace
      .getLeavesOfType("markdown")
      .find((l) => l.view.file?.path === "Selection UX.md")
      .view.editor.getSelection(),
  ),
  "asdf",
);
pass("real mouse selection opens the annotation pill");
await page.getByRole("button", { name: "Highlight blue", exact: true }).click();
let data = await metadata();
assert.equal(data.comments.length, 1);
assert.equal(data.comments[0].body, "");
assert.equal(data.comments[0].color, "blue");
assert.equal((await raw()).split("\n<!-- obsidian-comments:v1\n")[0], doc);
await expect(page.getByRole("dialog")).toHaveCount(0);
pass(
  "one color click saves a highlight with no modal and preserves exact document bytes",
);
await expect(page.locator(".comments-footer")).toHaveCount(0);
assert.equal(
  (
    await page.locator(".workspace-leaf.mod-active .cm-content").innerText()
  ).includes('"format"'),
  false,
);
pass("valid metadata stays folded with cursor in the annotated text");
await page
  .getByRole("button", { name: "Highlight purple", exact: true })
  .click();
await page
  .getByRole("button", { name: "Highlight purple", exact: true })
  .click();
data = await metadata();
assert.equal(data.comments.length, 1);
assert.equal(data.comments[0].color, "purple");
pass("recoloring and repeated same-color clicks preserve one annotation");
await page.getByRole("button", { name: "Add note", exact: true }).click();
await page
  .getByRole("textbox", { name: "Note for selected text" })
  .fill("Check <script>window.PILL_XSS=true</script> --> these coordinates.");
await page.getByRole("button", { name: "Save note", exact: true }).click();
data = await metadata();
assert.equal(data.comments.length, 1);
assert.ok(data.comments[0].body.includes("<script>"));
assert.equal(await api(() => window.PILL_XSS), undefined);
pass("inline note is saved onto the highlight as inert text");
const exact = await raw();
await api(() => app.commands.executeCommandById("annotations:toggle-data"));
await expect(
  page.locator(".workspace-leaf.mod-active .cm-content"),
).toContainText('"format"');
await api(() => app.commands.executeCommandById("annotations:toggle-data"));
assert.equal(await raw(), exact);
assert.equal(
  (
    await page.locator(".workspace-leaf.mod-active .cm-content").innerText()
  ).includes('"format"'),
  false,
);
pass(
  "explicit raw inspection expands and folds without modifying any stored bytes",
);
await page.keyboard.press("Control+End");
assert.equal(
  await api(() => {
    const e = app.workspace
      .getLeavesOfType("markdown")
      .find((l) => l.view.file?.path === "Selection UX.md").view.editor;
    return e.posToOffset(e.getCursor());
  }),
  doc.length,
);
const beforeDelete = await raw();
await page.keyboard.press("Delete");
assert.equal(await raw(), beforeDelete);
pass("forward Delete cannot remove the folded storage separator");
await page.keyboard.type("More text.");
assert.equal(
  (await raw()).split("\n<!-- obsidian-comments:v1\n")[0],
  doc + "More text.",
);
await metadata();
pass(
  "Ctrl+End and typing stay in document text rather than appending after the footer",
);
await select("longer paragraph");
await page.getByRole("button", { name: "Add note", exact: true }).click();
await page
  .getByRole("textbox", { name: "Note for selected text" })
  .fill("A note without a separate highlight click");
await page.getByRole("button", { name: "Save note", exact: true }).click();
assert.equal((await metadata()).comments.length, 2);
pass(
  "Add note directly creates a highlighted annotation without an intermediate color click",
);
await select("optional note");
await page.getByRole("button", { name: "Add note", exact: true }).click();
await page
  .getByRole("textbox", { name: "Note for selected text" })
  .fill("Draft before choosing a color");
await page
  .getByRole("button", { name: "Highlight green", exact: true })
  .click();
await page.getByRole("button", { name: "Save note", exact: true }).click();
data = await metadata();
assert.equal(data.comments.length, 3);
assert.equal(data.comments[2].color, "green");
assert.equal(data.comments[2].body, "Draft before choosing a color");
pass(
  "choosing a color while composing keeps the draft and saves to that same highlight",
);
await select("A longer");
await page.getByRole("button", { name: "Highlight red", exact: true }).click();
await page.getByRole("button", { name: "Add note", exact: true }).click();
await page
  .getByRole("textbox", { name: "Note for selected text" })
  .fill("Canceled draft");
await page.getByRole("button", { name: "Cancel", exact: true }).click();
assert.equal((await metadata()).comments.at(-1).body, "");
pass("canceling an optional note preserves the already chosen highlight");
await select("asdf");
await api(() => app.commands.executeCommandById("annotations:note-selection"));
await expect(
  page.getByRole("textbox", { name: "Note for selected text" }),
).toBeFocused();
await page
  .getByRole("textbox", { name: "Note for selected text" })
  .fill("Keyboard note");
await page.keyboard.press("Control+Enter");
assert.equal((await metadata()).comments[0].body, "Keyboard note");
pass("command palette route and Ctrl+Enter save work with keyboard focus");
await select("asdf");
await page.getByRole("button", { name: "Edit note", exact: true }).click();
await page
  .getByRole("textbox", { name: "Note for selected text" })
  .fill("Must not overwrite after a source edit");
await api(() => {
  const e = app.workspace
    .getLeavesOfType("markdown")
    .find((l) => l.view.file?.path === "Selection UX.md").view.editor;
  e.replaceRange("External prefix\n", { line: 7, ch: 0 });
});
await page.getByRole("button", { name: "Save note", exact: true }).click();
await expect(page.locator(".comments-inline-error")).toContainText(
  "note changed",
);
assert.equal((await metadata()).comments[0].body, "Keyboard note");
await page.getByRole("button", { name: "Cancel", exact: true }).click();
pass(
  "source changes while composing reject a stale save and preserve the previous note",
);
await expect
  .poll(async () =>
    (await readFile("tests/fixtures/vault/Selection UX.md", "utf8")).includes(
      "Keyboard note",
    ),
  )
  .toBe(true);
await api(async () => {
  const f = app.vault.getAbstractFileByPath("Selection UX.md");
  for (const l of app.workspace.getLeavesOfType("markdown"))
    if (l.view.file === f) await l.setViewState({ type: "empty" });
  const l = app.workspace.getLeaf(false);
  await l.openFile(f, { state: { mode: "source", source: false } });
  app.workspace.setActiveLeaf(l);
});
assert.equal((await metadata()).comments.length, 4);
await expect(page.locator(".comments-footer")).toHaveCount(0);
assert.equal(
  (
    await page.locator(".workspace-leaf.mod-active .cm-content").innerText()
  ).includes('"format"'),
  false,
);
pass("reopening preserves highlights/notes and keeps the footer folded");
await api(() => app.commands.executeCommandById("annotations:open"));
await expect(page.locator(".comments-add-note")).toHaveCount(1);
pass("highlight-only annotations offer Add a note in the sidebar");
// Source mode uses the same safe presentation, without depending on Live Preview's comment hiding.
await api(async () => {
  const l = app.workspace
    .getLeavesOfType("markdown")
    .find((l) => l.view.file?.path === "Selection UX.md");
  await l.setViewState({
    type: "markdown",
    state: { file: "Selection UX.md", mode: "source", source: true },
  });
  app.workspace.setActiveLeaf(l);
  app.workspace.rightSplit.collapse();
});
await expect(page.locator(".comments-footer")).toHaveCount(0);
assert.equal(
  (
    await page.locator(".workspace-leaf.mod-active .cm-content").innerText()
  ).includes('"format"'),
  false,
);
pass("Source mode also folds the JSON footer");
await select("asdf");
await page.getByRole("button", { name: "Edit note", exact: true }).click();
await page.setViewportSize({ width: 390, height: 844 });
await page.mouse.move(1, 400);
await page.waitForTimeout(300);
await expect(
  page.getByRole("textbox", { name: "Note for selected text" }),
).toBeVisible();
const bounds = await page.locator(".comments-inline-compose").boundingBox();
assert.ok(bounds.x >= 0 && bounds.x + bounds.width <= 391);
await page.screenshot({ path: "evidence/selection-compose-narrow.png" });
await page.getByRole("button", { name: "Cancel", exact: true }).click();
pass("inline note composer stays inside a 390px window");
assert.deepEqual(errors, []);
await writeFile(
  "evidence/selection-results.json",
  JSON.stringify({ obsidian: "1.15.1", checks, errors }, null, 2),
);
await page.setViewportSize({ width: 1200, height: 900 });
await browser.close();
