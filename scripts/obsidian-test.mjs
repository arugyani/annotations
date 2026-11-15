import { chromium, expect } from "playwright/test";
import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
const browser = await chromium.connectOverCDP("http://127.0.0.1:9223");
const page = browser
  .contexts()[0]
  .pages()
  .find((p) => p.url().startsWith("app://obsidian.md/index"));
for (const other of browser.contexts()[0].pages())
  if (other !== page) await other.close();
const errors = [];
page.on("pageerror", (e) => errors.push(String(e)));
const checks = [];
const check = (name) => {
  checks.push(name);
  console.log("PASS", name);
};
const run = (fn) => page.evaluate(fn);
const action = async (card, name) => {
  await card
    .getByRole("button", { name: "Comment actions", exact: true })
    .click();
  await page
    .locator(".menu .menu-item")
    .filter({ hasText: new RegExp("^" + name + "$") })
    .click();
};
const note =
  "# Runtime checks\n\nAlpha target phrase and café 🌙.\n\n## Next\n\nA second paragraph.\n\n- one\n  - nested\n\n| Name | Value |\n| --- | --- |\n| A | B |\n\n```md\n# code heading\n```\n";
await page.evaluate(async (text) => {
  const previous = app.vault.getAbstractFileByPath("Runtime renamed.md");
  if (previous) await app.vault.delete(previous);
  let file = app.vault.getAbstractFileByPath("Runtime.md");
  if (file) await app.vault.modify(file, text);
  else file = await app.vault.create("Runtime.md", text);
  await app.workspace
    .getLeaf(false)
    .openFile(file, { state: { mode: "source" } });
  await app.plugins.plugins.annotations.show();
}, note);
await expect(page.locator(".comments-empty")).toContainText("Select a passage");
await run(() => {
  const v = app.workspace
    .getLeavesOfType("markdown")
    .find((l) => l.view.file?.path === "Runtime.md").view;
  app.workspace.setActiveLeaf(v.leaf);
  const e = v.editor;
  e.focus();
  const at = e.getValue().indexOf("target phrase");
  e.setSelection(e.offsetToPos(at), e.offsetToPos(at + 13));
  app.commands.executeCommandById("annotations:add-selection");
});
await page
  .getByRole("textbox", { name: "Comment", exact: true })
  .fill("Check <script>window.COMMENTS_XSS=true</script> --> safely.");
await page
  .getByRole("textbox", { name: "Author", exact: true })
  .fill("Test reader");
await page
  .getByRole("combobox", { name: "Comment color", exact: true })
  .selectOption("red");
await page.getByRole("button", { name: "Save comment", exact: true }).click();
await expect(page.locator(".comments-card")).toHaveCount(1);
assert.equal(await run(() => window.COMMENTS_XSS), undefined);
check("selection command, author/color, safe literal body and sidebar");
await page
  .locator(".cm-content .comments-highlight.comments-red")
  .first()
  .click();
await expect(page.locator(".comments-card.is-selected")).toHaveCount(1);
check("actual editor highlight reveals its sidebar comment");
await action(page.locator(".comments-card"), "Edit");
await page
  .getByRole("textbox", { name: "Comment", exact: true })
  .fill("Updated annotation");
await page.getByRole("button", { name: "Save comment", exact: true }).click();
await expect(page.locator(".comments-body")).toHaveText("Updated annotation");
await page.getByRole("button", { name: "Open comments", exact: true }).click();
await page.getByRole("button", { name: "Resolve", exact: true }).click();
await expect(page.locator(".comments-card")).toHaveCount(0);
await page
  .getByRole("button", { name: "Resolved comments", exact: true })
  .click();
await expect(page.locator(".comments-card")).toHaveCount(1);
await page.getByRole("button", { name: "Reopen", exact: true }).click();
await page.getByRole("button", { name: "Open comments", exact: true }).click();
await expect(page.locator(".comments-card")).toHaveCount(1);
check("edit, resolve, resolved filter and reopen");
const data = () =>
  run(() => {
    const v = app.workspace
      .getLeavesOfType("markdown")
      .find((l) => l.view.file?.path === "Runtime.md").view;
    return v.editor.getValue();
  });
const footer = (raw) =>
  JSON.parse(raw.split("\n<!-- obsidian-comments:v1\n")[1].split("\n-->")[0]);
await run(() => {
  const e = app.workspace
    .getLeavesOfType("markdown")
    .find((l) => l.view.file?.path === "Runtime.md").view.editor;
  e.replaceRange("Intro\n", { line: 0, ch: 0 });
});
let raw = await data();
assert.equal(footer(raw).comments[0].target.from, raw.indexOf("target phrase"));
check("actual editor moves anchor when typing before target");
await run(() => {
  const e = app.workspace
    .getLeavesOfType("markdown")
    .find((l) => l.view.file?.path === "Runtime.md").view.editor;
  const at = e.getValue().indexOf("target phrase") + 6;
  e.replaceRange(" NEW", e.offsetToPos(at));
});
raw = await data();
assert.equal(footer(raw).comments[0].target.quote, "target NEW phrase");
await run(() => {
  const l = app.workspace
    .getLeavesOfType("markdown")
    .find((l) => l.view.file?.path === "Runtime.md");
  app.workspace.setActiveLeaf(l);
  l.view.editor.focus();
});
await page.keyboard.press("Control+z");
assert.equal(footer(await data()).comments[0].target.quote, "target phrase");
await page.keyboard.press("Control+y");
assert.equal(
  footer(await data()).comments[0].target.quote,
  "target NEW phrase",
);
check("actual editor inside-target edits, undo and redo");
// Reopen the file from disk after the editor has saved it.
await expect
  .poll(async () => {
    const text = await readFile("tests/fixtures/vault/Runtime.md", "utf8");
    return text.includes("target NEW phrase");
  })
  .toBe(true);
await run(async () => {
  for (const l of app.workspace.getLeavesOfType("markdown"))
    if (l.view.file?.path === "Runtime.md")
      await l.setViewState({ type: "empty" });
  await app.workspace
    .getLeaf(false)
    .openFile(app.vault.getAbstractFileByPath("Runtime.md"), {
      state: { mode: "source" },
    });
});
assert.equal(footer(await data()).comments[0].body, "Updated annotation");
check("disk persistence after closing and reopening note");
// Delete target, then reattach through the real UI and command.
await run(() => {
  const e = app.workspace
    .getLeavesOfType("markdown")
    .find((l) => l.view.file?.path === "Runtime.md").view.editor;
  const at = e.getValue().indexOf("target NEW phrase");
  e.replaceRange("", e.offsetToPos(at), e.offsetToPos(at + 17));
});
assert.equal(footer(await data()).comments[0].target.state, "detached");
await expect(page.locator(".comments-warning")).toBeVisible();
await action(page.locator(".comments-card"), "Reattach");
await run(() => {
  const e = app.workspace
    .getLeavesOfType("markdown")
    .find((l) => l.view.file?.path === "Runtime.md").view.editor;
  app.workspace.setActiveLeaf(
    app.workspace
      .getLeavesOfType("markdown")
      .find((l) => l.view.file?.path === "Runtime.md"),
  );
  e.focus();
  const at = e.getValue().indexOf("second paragraph");
  e.setSelection(e.offsetToPos(at), e.offsetToPos(at + 16));
  app.commands.executeCommandById("annotations:reattach");
});
await expect(page.locator(".comments-warning")).toHaveCount(0);
assert.equal(footer(await data()).comments[0].target.quote, "second paragraph");
check("target deletion and manual reattachment");
// Create file/block/section annotations through their actual commands and modals.
for (const kind of ["block", "section", "file"]) {
  await run(() => {
    const l = app.workspace
      .getLeavesOfType("markdown")
      .find((l) => l.view.file?.path === "Runtime.md");
    app.workspace.setActiveLeaf(l);
    l.view.editor.focus();
  });
  await page.evaluate(
    (k) => app.commands.executeCommandById(`annotations:add-${k}`),
    kind,
  );
  await page
    .getByRole("textbox", { name: "Comment", exact: true })
    .fill(`${kind} annotation`);
  await page.getByRole("button", { name: "Save comment", exact: true }).click();
}
await expect(page.locator(".comments-card")).toHaveCount(4);
check("block, section and entire-file commands");
await action(page.locator(".comments-card").last(), "Delete");
await page.getByRole("button", { name: "Delete comment", exact: true }).click();
await expect(page.locator(".comments-card")).toHaveCount(3);
check("delete confirmation removes only the chosen comment");
await run(() => {
  const l = app.workspace
    .getLeavesOfType("markdown")
    .find((l) => l.view.file?.path === "Runtime.md");
  app.workspace.setActiveLeaf(l);
  l.view.editor.focus();
  app.commands.executeCommandById("annotations:add-file");
});
await page
  .getByRole("textbox", { name: "Comment", exact: true })
  .fill("file annotation");
await page.getByRole("button", { name: "Save comment", exact: true }).click();
await expect(page.locator(".comments-card")).toHaveCount(4);
await page
  .getByRole("button", { name: "Filter comments", exact: true })
  .click();
await page.getByText("Red", { exact: true }).click();
await expect(page.locator(".comments-card")).toHaveCount(1);
await page
  .getByRole("button", { name: "Search comments", exact: true })
  .click();
await page
  .getByRole("searchbox", { name: "Search comments" })
  .fill("nonexistent");
await expect(page.locator(".comments-empty")).toContainText("No comments here");
await page.getByRole("searchbox", { name: "Search comments" }).fill("");
await page.getByRole("button", { name: "Clear comment filters" }).click();
check("color/search filters and clear empty state");
// Rename and reading renderer.
await run(async () => {
  await app.fileManager.renameFile(
    app.vault.getAbstractFileByPath("Runtime.md"),
    "Runtime renamed.md",
  );
});
await expect(page.locator(".comments-subtitle")).toContainText(
  "Runtime renamed",
);
await expect(page.locator(".comments-card")).toHaveCount(4);
check("file rename retains all in-file records");
await run(async () => {
  const v = app.workspace
    .getLeavesOfType("markdown")
    .find((l) => l.view.file?.path === "Runtime renamed.md");
  await v.setViewState({
    type: "markdown",
    state: { file: "Runtime renamed.md", mode: "preview" },
  });
});
await expect(
  page.locator(".markdown-preview-view mark.comments-highlight").first(),
).toBeVisible();
await page
  .locator(".markdown-preview-view mark.comments-highlight")
  .first()
  .click();
await expect(page.locator(".comments-card.is-selected").first()).toBeVisible();
check("Reading view highlights reveal comments without extra buttons");
// External filesystem edit while in Reading view; lifecycle must atomically use the latest bytes.
const runtimePath = "tests/fixtures/vault/Runtime renamed.md";
const beforeExternal = await readFile(runtimePath, "utf8");
await writeFile(runtimePath, "External prefix\n" + beforeExternal);
await page.waitForTimeout(700);
await run(() => app.plugins.plugins.annotations.refresh());
await expect(page.locator(".comments-card")).toHaveCount(4);
await page
  .locator(".comments-card")
  .first()
  .getByRole("button", { name: "Resolve", exact: true })
  .click();
await expect
  .poll(
    async () => footer(await readFile(runtimePath, "utf8")).comments[0].status,
  )
  .toBe("resolved");
const savedExternal = await readFile(runtimePath, "utf8");
assert.ok(savedExternal.startsWith("External prefix\n"));
assert.equal(
  footer(savedExternal).comments[0].target.from,
  savedExternal.indexOf("second paragraph"),
);
check(
  "external filesystem edit preserves latest content and reconciles offsets through atomic write",
);
await writeFile(
  runtimePath,
  savedExternal.replace("second paragraph", "changed externally"),
);
await page.waitForTimeout(700);
await run(() => app.plugins.plugins.annotations.refresh());
await page
  .getByRole("button", { name: "Filter comments", exact: true })
  .click();
await page.getByText("Needs reattachment", { exact: true }).click();
await expect(page.locator(".comments-warning").first()).toBeVisible();
check(
  "external target replacement remains preserved and visibly needs reattachment",
);
await page.getByRole("button", { name: "Open comments", exact: true }).click();
// Malformed metadata must not change through lifecycle or editor operations.
const protectedBefore = await readFile(
  "tests/fixtures/vault/Malformed.md",
  "utf8",
);
await run(async () => {
  await app.workspace
    .getLeaf(false)
    .openFile(app.vault.getAbstractFileByPath("Malformed.md"));
  await app.plugins.plugins.annotations.show();
});
await expect(page.locator(".comments-error")).toContainText(
  "Invalid annotation",
);
await run(async () => {
  const p = app.plugins.plugins.annotations;
  await p.change(app.vault.getAbstractFileByPath("Malformed.md"), () => []);
});
assert.equal(
  await readFile("tests/fixtures/vault/Malformed.md", "utf8"),
  protectedBefore,
);
check("malformed footer refuses actual vault write");
// Capture actual app at desktop and narrow viewport sizes in both themes.
await run(async () => {
  await app.workspace
    .getLeaf(false)
    .openFile(app.vault.getAbstractFileByPath("Welcome.md"), {
      state: { mode: "source" },
    });
  app.workspace.leftSplit.collapse();
  await app.plugins.plugins.annotations.show();
});
await expect(page.locator(".notice-container .notice")).toHaveCount(0, {
  timeout: 10000,
});
for (const theme of ["light", "dark"]) {
  await page.evaluate((t) => {
    document.body.classList.toggle("theme-dark", t === "dark");
    document.body.classList.toggle("theme-light", t === "light");
  }, theme);
  await page.setViewportSize({ width: 1200, height: 900 });
  await run(async () => {
    const leaf = app.workspace
      .getLeavesOfType("markdown")
      .find((l) => l.view.file?.path === "Welcome.md");
    app.workspace.setActiveLeaf(leaf);
    leaf.view.editor.setCursor({ line: 0, ch: 0 });
    leaf.view.editor.scrollIntoView(
      { from: { line: 0, ch: 0 }, to: { line: 2, ch: 0 } },
      true,
    );
    await app.plugins.plugins.annotations.show();
  });
  await page.mouse.move(1, 400);
  await page.waitForTimeout(400);
  await page.screenshot({ path: `evidence/desktop-${theme}.png` });
  await page.setViewportSize({ width: 390, height: 844 });
  await run(() => app.plugins.plugins.annotations.show());
  await expect(page.locator(".notice-container .notice")).toHaveCount(0, {
    timeout: 10000,
  });
  await page.mouse.move(1, 400);
  await page.waitForTimeout(400);
  await page.screenshot({ path: `evidence/narrow-${theme}.png` });
  assert.equal(
    await page
      .locator(".comments-panel")
      .evaluate((el) => el.scrollWidth <= el.clientWidth),
    true,
  );
}
check(
  "actual app desktop/narrow layout in light/dark themes, no panel horizontal overflow",
);
assert.deepEqual(errors, []);
check("no renderer JavaScript errors during run");
await writeFile(
  "evidence/runtime-results.json",
  JSON.stringify({ obsidian: "1.15.1", checks, errors }, null, 2),
);
await page.setViewportSize({ width: 1200, height: 900 });
await browser.close();
