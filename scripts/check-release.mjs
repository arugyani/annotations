import assert from "node:assert/strict";
import { readFile, stat } from "node:fs/promises";
const json = async (path) => JSON.parse(await readFile(path, "utf8"));
const manifest = await json("manifest.json"),
  pkg = await json("package.json"),
  lock = await json("package-lock.json"),
  versions = await json("versions.json");
assert.equal(manifest.id, "annotations");
assert.match(manifest.version, /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/);
assert.equal(pkg.version, manifest.version);
assert.equal(lock.version, manifest.version);
assert.equal(lock.packages[""].version, manifest.version);
assert.equal(versions[manifest.version], manifest.minAppVersion);
if (process.env.RELEASE_TAG)
  assert.equal(
    process.env.RELEASE_TAG,
    manifest.version,
    "Release tag must equal manifest version, without a v prefix",
  );
assert.equal(manifest.isDesktopOnly, false);
assert.ok(
  !pkg.dependencies || Object.keys(pkg.dependencies).length === 0,
  "No packaged runtime dependencies",
);
for (const name of ["main.js", "styles.css"])
  assert.ok((await stat(name)).size > 0);
assert.ok(
  (await stat("main.js")).size < 128_000,
  "Bundle exceeds the reviewed startup size budget",
);
const meta = await json("dist/metafile.json");
assert.ok(
  Object.keys(meta.inputs).every((path) => path.startsWith("src/")),
  "Unexpected bundled dependency",
);
const host = new Set([
  "obsidian",
  "@codemirror/state",
  "@codemirror/commands",
  "@codemirror/view",
  "@codemirror/language",
  "@lezer/common",
]);
for (const output of Object.values(meta.outputs))
  for (const item of output.imports)
    assert.ok(
      item.external && host.has(item.path),
      `Unexpected runtime import: ${item.path}`,
    );
console.log(
  `Validated Annotations ${manifest.version}: manifest, tag, compatibility map, and host-only bundle.`,
);
