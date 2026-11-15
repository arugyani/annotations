import { mkdir, copyFile, readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
const { version } = JSON.parse(await readFile("manifest.json", "utf8"));
const output = `release/${version}`;
await mkdir(output, { recursive: true });
const names = ["main.js", "manifest.json", "styles.css"];
for (const file of names) await copyFile(file, `${output}/${file}`);
await copyFile("docs/RELEASE_NOTES.md", `${output}/RELEASE_NOTES.md`);
const sums = [];
for (const name of names) {
  const digest = createHash("sha256")
    .update(await readFile(`${output}/${name}`))
    .digest("hex");
  sums.push(`${digest}  ${name}`);
}
await writeFile(`${output}/SHA256SUMS`, sums.join("\n") + "\n");
console.log(`Release assets prepared in ${output}/`);
