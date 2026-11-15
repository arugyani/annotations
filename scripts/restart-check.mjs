import { chromium, expect } from "playwright/test";
import { readFile, writeFile } from "node:fs/promises";
import assert from "node:assert/strict";
const browser = await chromium.connectOverCDP("http://127.0.0.1:9223");
const page = browser
  .contexts()[0]
  .pages()
  .find((p) => p.url().startsWith("app://obsidian.md/index"));
await page.waitForFunction(() => !!window.app?.plugins.plugins.annotations);
assert.equal(
  await page.evaluate(() => app.plugins.plugins.annotations.manifest.version),
  "1.0.1",
);
await page.evaluate(async () => {
  await app.workspace
    .getLeaf(false)
    .openFile(app.vault.getAbstractFileByPath("Runtime renamed.md"), {
      state: { mode: "source" },
    });
  await app.plugins.plugins.annotations.show();
});
await expect(page.locator(".comments-subtitle")).toContainText(
  "Runtime renamed",
);
const raw = await readFile("tests/fixtures/vault/Runtime renamed.md", "utf8");
const records = JSON.parse(
  raw.split("\n<!-- obsidian-comments:v1\n")[1].split("\n-->")[0],
).comments;
assert.equal(records.length, 4);
assert.equal(records[0].body, "Updated annotation");
assert.equal(records[0].status, "resolved");
assert.ok(raw.startsWith("External prefix\n"));
await page
  .getByRole("combobox", { name: "Filter by status" })
  .selectOption("all");
await expect(page.locator(".comments-card")).toHaveCount(4);
await page.locator(".comments-target").first().focus();
await page.keyboard.press("Tab");
assert.equal(
  await page.evaluate(
    () => getComputedStyle(document.activeElement).outlineStyle,
  ),
  "solid",
);
await page
  .locator(".comments-card")
  .first()
  .getByRole("button", { name: "Comment actions" })
  .focus();
await page.keyboard.press("Enter");
await expect(
  page.locator(".menu .menu-item").filter({ hasText: /^Edit$/ }),
).toBeVisible();
await page.keyboard.press("Escape");
const report = JSON.parse(
  await readFile("evidence/runtime-results.json", "utf8"),
);
report.checks.push(
  "application restart reloads plugin and all saved comments from Markdown",
  "keyboard tab navigation has a visible focus outline",
  "native comment action menu opens from keyboard",
);
await writeFile(
  "evidence/runtime-results.json",
  JSON.stringify(report, null, 2),
);
console.log(
  "PASS full Obsidian restart preserves plugin, four comments, status, body, and external source changes",
);
console.log("PASS keyboard focus outline");
const session = await browser.newBrowserCDPSession();
await session.send("Browser.close").catch(() => {});
