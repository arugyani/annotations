import { chromium } from "playwright/test";
import { newComment, serialize } from "../src/model";
import { writeFile } from "node:fs/promises";
const label = process.argv[2];
if (!["before", "after"].includes(label))
  throw new Error("Pass before or after");
const output = process.argv[3] ?? label;
if (!/^[a-zA-Z0-9.-]+$/.test(output)) throw new Error("Invalid output label");
const browser = await chromium.connectOverCDP("http://127.0.0.1:9223");
const page = browser
  .contexts()[0]
  .pages()
  .find((p) => p.url().startsWith("app://obsidian.md/index"))!;
const doc = Array.from(
  { length: 1800 },
  (_, i) =>
    `Paragraph ${i}: synthetic content for responsiveness measurement.\n\n`,
).join("");
const comments = Array.from({ length: 100 }, (_, i) => {
  const at = doc.indexOf(`Paragraph ${i * 17}:`);
  return newComment(
    doc,
    at,
    at + 14,
    "selection",
    "A short note",
    "Test",
    "yellow",
  );
});
await page.evaluate(
  async (raw) => {
    const a = (window as any).app;
    let file = a.vault.getAbstractFileByPath("Performance.md");
    if (file) await a.vault.modify(file, raw);
    else file = await a.vault.create("Performance.md", raw);
    const leaf = a.workspace.getLeaf(false);
    await leaf.openFile(file, { state: { mode: "source" } });
    a.workspace.setActiveLeaf(leaf);
    await a.plugins.plugins.annotations.show();
  },
  serialize(doc, comments),
);
await page.waitForTimeout(400);
const result = await page.evaluate(async () => {
  const a = (window as any).app,
    leaf = a.workspace
      .getLeavesOfType("markdown")
      .find((l: any) => l.view.file?.path === "Performance.md"),
    e = leaf.view.editor;
  const times = [];
  a.workspace.setActiveLeaf(leaf);
  e.setCursor({ line: 0, ch: 0 });
  e.focus();
  for (let i = 0; i < 80; i++) {
    const t = performance.now();
    e.replaceRange("a", e.offsetToPos(10));
    const elapsed = performance.now() - t;
    if (i >= 10) times.push(elapsed);
    if (i % 10 === 0) await new Promise(requestAnimationFrame);
  }
  await new Promise((r) => setTimeout(r, 250));
  const first = document.querySelector(".comments-card");
  const search = document.querySelector<HTMLInputElement>(
    ".comments-filters input",
  )!;
  let mutations = 0;
  const observer = new MutationObserver((records) => {
    mutations += records.length;
  });
  observer.observe(document.querySelector(".comments-panel")!, {
    childList: true,
    subtree: true,
    characterData: true,
    attributes: true,
  });
  // Prefix changes offsets/context, but no visible comment content.
  search.focus();
  e.replaceRange("prefix\n", { line: 0, ch: 0 });
  await new Promise((r) => setTimeout(r, 300));
  observer.disconnect();
  const reused = first === document.querySelector(".comments-card"),
    searchReused = search === document.querySelector(".comments-filters input");
  times.sort((x, y) => x - y);
  return {
    samples: times.length,
    medianDispatchMs: times[Math.floor(times.length * 0.5)],
    p95DispatchMs: times[Math.floor(times.length * 0.95)],
    p99DispatchMs: times[Math.floor(times.length * 0.99)],
    sidebarMutationsForPrefixEdit: mutations,
    sidebarFirstRowReused: reused,
    searchControlReused: searchReused,
    searchFocusPreserved: document.activeElement === search,
  };
});
// Measure enable time with the same open synthetic note. This is warm enable, not cold app startup.
const enableTimes = await page.evaluate(async () => {
  const a = (window as any).app;
  const times = [];
  for (let i = 0; i < 5; i++) {
    await a.plugins.disablePlugin("annotations");
    const t = performance.now();
    await a.plugins.enablePlugin("annotations");
    times.push(performance.now() - t);
  }
  return times;
});
await writeFile(
  `evidence/performance-app-${output}.json`,
  JSON.stringify(
    {
      obsidian: "1.15.1",
      documentCharacters: doc.length,
      comments: 100,
      ...result,
      warmEnableMs: enableTimes,
    },
    null,
    2,
  ),
);
console.log(JSON.stringify(result));
await browser.close();
