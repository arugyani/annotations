import { chromium } from "playwright/test";
import { newComment, serialize } from "../src/model";
import { writeFile } from "node:fs/promises";
import assert from "node:assert/strict";
import { benchmarkMetadata } from "./benchmark-metadata.mjs";
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
    // Each run starts with exactly one fresh editor. Otherwise an older hidden
    // leaf can be measured while the sidebar reads a different editor snapshot.
    for (const leaf of a.workspace.getLeavesOfType("markdown")) leaf.detach();
    const leaf = a.workspace.getLeaf(false);
    await leaf.openFile(file, { state: { mode: "source" } });
    a.workspace.setActiveLeaf(leaf);
    await a.plugins.plugins.annotations.show();
  },
  serialize(doc, comments),
);
await page.waitForTimeout(400);
assert.equal(await page.locator(".comments-card").count(), 100);
await page
  .getByRole("button", { name: "Search comments", exact: true })
  .click();
const environment = await page.evaluate(() => {
  const a = (window as any).app;
  return {
    obsidian: (window as any).electron.remote.app.getVersion(),
    electron: process.versions.electron,
    chromium: process.versions.chrome,
    viewport: { width: innerWidth, height: innerHeight },
    enabledPlugins: Object.keys(a.plugins.plugins),
    markdownEditors: a.workspace.getLeavesOfType("markdown").length,
    installedVersion: a.plugins.plugins.annotations.manifest.version,
    installedAssetSha256: Object.fromEntries(
      ["main.js", "styles.css", "manifest.json"].map((name) => {
        const bytes = require("node:fs").readFileSync(
          `${a.vault.adapter.basePath}/${a.vault.configDir}/plugins/annotations/${name}`,
        );
        return [
          name,
          require("node:crypto")
            .createHash("sha256")
            .update(bytes)
            .digest("hex"),
        ];
      }),
    ),
    appArguments: (window as any).electron.remote.process.argv,
  };
});
assert.equal(environment.markdownEditors, 1);
assert.equal(environment.installedVersion, benchmarkMetadata().pluginVersion);
assert.deepEqual(
  environment.installedAssetSha256,
  Object.fromEntries(
    Object.entries(benchmarkMetadata().assets).map(([name, asset]) => [
      name,
      asset.sha256,
    ]),
  ),
);
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
    ".comments-search input",
  )!;
  search.focus();
  await new Promise((r) => setTimeout(r, 250));
  let mutations = 0;
  const mutationDetails: {
    type: string;
    attribute: string | null;
    target: string;
  }[] = [];
  let rowMutations = 0;
  const observer = new MutationObserver((records) => {
    mutations += records.length;
    for (const record of records) {
      const target =
        record.target instanceof Element
          ? record.target
          : record.target.parentElement;
      if (target?.closest(".comments-card")) rowMutations++;
      mutationDetails.push({
        type: record.type,
        attribute: record.attributeName,
        target: target?.className || target?.tagName || "unknown",
      });
    }
  });
  observer.observe(document.querySelector(".comments-panel")!, {
    childList: true,
    subtree: true,
    characterData: true,
    attributes: true,
  });
  // Prefix changes offsets/context, but no visible comment content.
  e.replaceRange("prefix\n", { line: 0, ch: 0 });
  await new Promise((r) => setTimeout(r, 300));
  observer.disconnect();
  const reused = first === document.querySelector(".comments-card"),
    searchReused = search === document.querySelector(".comments-search input");
  const dispatchMs = times.slice();
  times.sort((x, y) => x - y);
  return {
    samples: times.length,
    warmupDispatches: 10,
    dispatchMs,
    medianDispatchMs: times[Math.floor(times.length * 0.5)],
    p95DispatchMs: times[Math.floor(times.length * 0.95)],
    p99DispatchMs: times[Math.floor(times.length * 0.99)],
    sidebarMutationsForPrefixEdit: mutations,
    sidebarRowMutationsForPrefixEdit: rowMutations,
    mutationDetails,
    sidebarFirstRowReused: reused,
    searchControlReused: searchReused,
    searchFocusPreserved: document.activeElement === search,
  };
});
assert.equal(result.sidebarRowMutationsForPrefixEdit, 0);
assert.equal(result.sidebarFirstRowReused, true);
assert.equal(result.searchControlReused, true);
assert.equal(result.searchFocusPreserved, true);
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
      ...benchmarkMetadata(),
      ...environment,
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
