import { chromium, expect } from "playwright/test";
const browser = await chromium.connectOverCDP("http://127.0.0.1:9223");
const page = browser
  .contexts()[0]
  .pages()
  .find((p) => p.url().startsWith("app://obsidian.md/index"));
const doc =
  '---\ncoordinates:\n  - "64.96"\n  - "-19.02"\ntype: "[[Country]]"\n---\n\nCheck the coordinates before publishing this country guide.\n\nThe final review is on Friday.\n';
await page.setViewportSize({ width: 1200, height: 900 });
await page.evaluate(async (doc) => {
  let f = app.vault.getAbstractFileByPath("Iceland.md");
  if (f) await app.vault.modify(f, doc);
  else f = await app.vault.create("Iceland.md", doc);
  let l =
    app.workspace.getLeavesOfType("markdown").find((l) => l.view.file === f) ??
    app.workspace.getLeaf(false);
  await l.openFile(f, { state: { mode: "source", source: false } });
  app.workspace.setActiveLeaf(l);
  app.workspace.leftSplit.collapse();
  app.workspace.rightSplit.collapse();
  const e = l.view.editor,
    at = e.getValue().indexOf("Check the coordinates") + 10;
  e.setSelection(e.offsetToPos(at), e.offsetToPos(at + 11));
  e.focus();
}, doc);
await expect(
  page.getByRole("button", { name: "Highlight blue", exact: true }),
).toBeVisible();
await page.getByRole("button", { name: "Highlight blue", exact: true }).click();
for (const theme of ["light", "dark"]) {
  await page.evaluate((theme) => {
    document.body.classList.toggle("theme-light", theme === "light");
    document.body.classList.toggle("theme-dark", theme === "dark");
  }, theme);
  await page.mouse.move(1, 500);
  await page.waitForTimeout(250);
  await page.screenshot({ path: `evidence/selection-${theme}.png` });
}
await page.getByRole("button", { name: "Add note", exact: true }).click();
await page
  .getByRole("textbox", { name: "Note for selected text" })
  .fill("Confirm these coordinates before publishing.");
await page.mouse.move(1, 500);
await page.waitForTimeout(250);
await page.screenshot({ path: "evidence/selection-compose.png" });
await page.setViewportSize({ width: 390, height: 844 });
await page.waitForTimeout(250);
await page.screenshot({ path: "evidence/selection-compose-narrow.png" });
await page.getByRole("button", { name: "Cancel", exact: true }).click();
await page.mouse.move(1, 500);
await page.waitForTimeout(250);
await page.screenshot({ path: "evidence/selection-narrow.png" });
await page.setViewportSize({ width: 1200, height: 900 });
await browser.close();
console.log(
  "Captured selection pill and inline composer in light, dark, and narrow layouts.",
);
