import { build, transform } from "esbuild";
import { mkdir, readFile, writeFile } from "node:fs/promises";
const result = await build({
  entryPoints: ["src/main.ts"],
  bundle: true,
  external: [
    "obsidian",
    "@codemirror/state",
    "@codemirror/commands",
    "@codemirror/view",
    "@codemirror/language",
    "@lezer/common",
  ],
  format: "cjs",
  target: "es2018",
  outfile: "main.js",
  metafile: true,
  sourcemap: false,
  minify: true,
  banner: {
    js: "/* Annotations — MIT License. https://github.com/arugyani/annotations */",
  },
});
const css = await transform(await readFile("src/styles.css", "utf8"), {
  loader: "css",
  minify: true,
});
await writeFile("styles.css", css.code);
await mkdir("dist", { recursive: true });
await writeFile(
  "dist/metafile.json",
  JSON.stringify(result.metafile, null, 2) + "\n",
);
