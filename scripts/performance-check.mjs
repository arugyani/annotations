import { chromium, expect } from "playwright/test";
import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";
const browser = await chromium.connectOverCDP("http://127.0.0.1:9223");
const page = browser
  .contexts()[0]
  .pages()
  .find((p) => p.url().startsWith("app://obsidian.md/index"));
await page.evaluate(async () => {
  const a = app;
  const leaf =
    a.workspace
      .getLeavesOfType("markdown")
      .find((l) => l.view.file?.path === "Welcome.md") ??
    a.workspace.getLeaf("tab");
  await leaf.openFile(a.vault.getAbstractFileByPath("Welcome.md"), {
    state: { mode: "source" },
  });
  a.workspace.setActiveLeaf(leaf);
  await a.plugins.plugins.annotations.show();
});
await expect(page.locator(".comments-card")).toHaveCount(4);
await page.waitForTimeout(300);
const checks = await page.evaluate(async () => {
  const p = app.plugins.plugins.annotations,
    vault = app.vault,
    files = [];
  const original = vault.read,
    reads = new Map();
  const passed = [];
  for (let i = 0; i < 6; i++) {
    const path = `Performance cache ${i}.md`;
    let f = vault.getAbstractFileByPath(path);
    if (f) await vault.modify(f, `# Cache ${i}\nInitial`);
    else f = await vault.create(path, `# Cache ${i}\nInitial`);
    files.push(f);
  }
  vault.read = function (file, ...args) {
    if (files.includes(file)) reads.set(file, (reads.get(file) || 0) + 1);
    return original.call(this, file, ...args);
  };
  const assert = (value, label) => {
    if (!value) throw new Error(label);
    passed.push(label);
  };
  try {
    const batch = await Promise.all(
      Array.from({ length: 50 }, () => p.note(files[0])),
    );
    assert(
      reads.get(files[0]) === 1 && batch.every((x) => x === batch[0]),
      "50 concurrent reading requests share one read and one validated snapshot",
    );
    await vault.modify(files[0], "# Changed externally\nUpdated");
    const updated = await p.note(files[0]);
    assert(
      updated.document.includes("Updated") && reads.get(files[0]) === 2,
      "vault modification invalidates cached content",
    );
    for (const f of files.slice(1)) await p.note(f);
    await p.note(files[0]);
    assert(
      reads.get(files[0]) === 3,
      "reading cache evicts older documents beyond its four-note limit",
    );
    const panel = document.querySelector(".comments-panel");
    let mutations = 0;
    const observer = new MutationObserver(
      (records) => (mutations += records.length),
    );
    observer.observe(panel, {
      subtree: true,
      childList: true,
      characterData: true,
      attributes: true,
    });
    await vault.modify(files[1], "# Unrelated change\nUpdated elsewhere");
    await new Promise((r) => setTimeout(r, 300));
    observer.disconnect();
    assert(
      mutations === 0,
      "unrelated note changes do not mutate the active comments UI",
    );
    const leaf = app.workspace
      .getLeavesOfType("markdown")
      .find((l) => l.view.file?.path === "Welcome.md");
    const f = leaf.view.file;
    const snapshot = await p.note(f),
      scroller = leaf.view.containerEl.querySelector(".cm-scroller");
    for (let i = 0; i < 12; i++) {
      scroller.scrollTop = i * 120;
      await new Promise(requestAnimationFrame);
    }
    assert(
      (await p.note(f)) === snapshot,
      "editor scrolling reuses the validated annotation snapshot",
    );
    scroller.scrollTop = 0;
  } finally {
    vault.read = original;
    for (const file of files) await vault.delete(file);
  }
  return passed;
});
assert.equal(checks.length, 5);
await writeFile(
  "evidence/performance-checks.json",
  JSON.stringify({ obsidian: "1.15.1", checks }, null, 2),
);
console.log(checks.map((c) => "PASS " + c).join("\n"));
await browser.close();
