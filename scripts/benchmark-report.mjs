import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";

const json = async (path) => JSON.parse(await readFile(path, "utf8"));
const { version } = await json("manifest.json");
const engine = [],
  app = [];
for (let i = 1; i <= 5; i++) {
  engine.push(
    await json(`evidence/performance-engine-${version}-run${i}.json`),
  );
  app.push(await json(`evidence/performance-app-${version}-run${i}.json`));
}
for (const run of [...engine, ...app]) {
  assert.equal(run.pluginVersion, version);
  assert.equal(run.pluginSourceChanged, false);
  assert.equal(run.sourceCommit, engine[0].sourceCommit);
  assert.deepEqual(run.assets, engine[0].assets);
}
for (const run of app) {
  assert.equal(run.markdownEditors, 1);
  assert.equal(run.installedVersion, version);
  assert.deepEqual(
    run.installedAssetSha256,
    Object.fromEntries(
      Object.entries(run.assets).map(([name, asset]) => [name, asset.sha256]),
    ),
  );
}
const stats = (values) => {
  const sorted = values.slice().sort((a, b) => a - b);
  const p = (fraction) =>
    sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * fraction))];
  return {
    samples: sorted.length,
    medianMs: p(0.5),
    p95Ms: p(0.95),
    p99Ms: p(0.99),
    minMs: sorted[0],
    maxMs: sorted.at(-1),
  };
};
const report = {
  pluginVersion: version,
  sourceCommit: engine[0].sourceCommit,
  generatedAt: new Date().toISOString(),
  independentEngineProcesses: engine.length,
  appRunsInOneProcess: app.length,
  assets: engine[0].assets,
  engine: engine[0].results.map((scenario, index) => ({
    scenario: scenario.scenario,
    documentCharacters: scenario.documentCharacters,
    comments: scenario.comments,
    dispatch: stats(engine.flatMap((run) => run.results[index].dispatchMs)),
    initialization: stats(engine.map((run) => run.results[index].loadMs)),
  })),
  app: {
    obsidian: app[0].obsidian,
    documentCharacters: app[0].documentCharacters,
    comments: app[0].comments,
    dispatch: stats(app.flatMap((run) => run.dispatchMs)),
    warmEnable: stats(app.flatMap((run) => run.warmEnableMs)),
    sidebarMutationsForPrefixEdit: app.map(
      (run) => run.sidebarMutationsForPrefixEdit,
    ),
    sidebarRowMutationsForPrefixEdit: app.map(
      (run) => run.sidebarRowMutationsForPrefixEdit,
    ),
    rowsAndSearchPreserved: app.every(
      (run) =>
        run.sidebarFirstRowReused &&
        run.searchControlReused &&
        run.searchFocusPreserved,
    ),
  },
};
await writeFile(
  `evidence/performance-summary-${version}.json`,
  JSON.stringify(report, null, 2) + "\n",
);
console.log(JSON.stringify(report, null, 2));
