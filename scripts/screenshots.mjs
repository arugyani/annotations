import { chromium, expect } from "playwright/test";
const browser = await chromium.connectOverCDP("http://127.0.0.1:9223");
const page = browser
  .contexts()[0]
  .pages()
  .find((p) => p.url().startsWith("app://obsidian.md/index"));
for (const theme of ["light", "dark"]) {
  await page.setViewportSize({ width: 1200, height: 900 });
  await page.evaluate(async (theme) => {
    document.body.classList.toggle("theme-dark", theme === "dark");
    document.body.classList.toggle("theme-light", theme === "light");
    const leaf =
      app.workspace
        .getLeavesOfType("markdown")
        .find((l) => l.view.file?.path === "Welcome.md") ??
      app.workspace.getLeaf("tab");
    await leaf.openFile(app.vault.getAbstractFileByPath("Welcome.md"), {
      state: { mode: "source" },
    });
    app.workspace.setActiveLeaf(leaf);
    app.workspace.leftSplit.collapse();
    leaf.view.editor.setCursor({ line: 0, ch: 0 });
    leaf.view.editor.scrollIntoView(
      { from: { line: 0, ch: 0 }, to: { line: 2, ch: 0 } },
      true,
    );
    await app.plugins.plugins.annotations.show();
  }, theme);
  await page.mouse.move(1, 400);
  await page.waitForTimeout(400);
  await page.screenshot({ path: `evidence/desktop-${theme}.png` });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.evaluate(() => app.plugins.plugins.annotations.show());
  await page.mouse.move(1, 400);
  await page.waitForTimeout(400);
  await expect(page.locator(".comments-panel")).toBeVisible();
  const dims = await page
    .locator(".comments-panel")
    .evaluate((el) => ({ width: el.clientWidth, scroll: el.scrollWidth }));
  if (dims.width < 320 || dims.scroll > dims.width)
    throw new Error("Narrow layout does not fit");
  await page.screenshot({ path: `evidence/narrow-${theme}.png` });
}
await page.setViewportSize({ width: 1200, height: 900 });
await browser.close();
console.log("Captured desktop and full-width narrow layouts in both themes.");
