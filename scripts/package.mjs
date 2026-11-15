import {
  mkdir,
  copyFile,
  readFile,
  writeFile,
  readdir,
} from "node:fs/promises";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
const { version, id } = JSON.parse(await readFile("manifest.json", "utf8"));
const output = `release/${version}`;
await mkdir(output, { recursive: true });
await mkdir(`sample-vault/.obsidian/plugins/${id}`, { recursive: true });
for (const file of ["manifest.json", "main.js", "styles.css"]) {
  await copyFile(file, `${output}/${file}`);
  await copyFile(file, `sample-vault/.obsidian/plugins/${id}/${file}`);
}
await copyFile("docs/RELEASE_NOTES.md", `${output}/RELEASE_NOTES.md`);
execFileSync("python3", [
  "-c",
  `
import pathlib, zipfile, sys
version, plugin_id=sys.argv[1:]
output=pathlib.Path('release')/version
assets=['manifest.json','main.js','styles.css']
with zipfile.ZipFile(output/f'annotations-{version}.zip','w',zipfile.ZIP_DEFLATED) as z:
 for name in assets:z.write(output/name,f'{plugin_id}/{name}')
with zipfile.ZipFile(output/f'annotations-test-vault-{version}.zip','w',zipfile.ZIP_DEFLATED) as z:
 for p in sorted(pathlib.Path('sample-vault').glob('*.md')):z.write(p,str(p))
 for name in ['app.json','appearance.json','community-plugins.json','core-plugins.json']:
  p=pathlib.Path('sample-vault/.obsidian')/name
  if p.exists():z.write(p,str(p))
 for name in assets:
  p=pathlib.Path('sample-vault/.obsidian/plugins')/plugin_id/name
  z.write(p,str(p))
`,
  version,
  id,
]);
const names = [
  "main.js",
  "manifest.json",
  "styles.css",
  `annotations-${version}.zip`,
  `annotations-test-vault-${version}.zip`,
];
const sums = [];
for (const name of names)
  sums.push(
    `${createHash("sha256")
      .update(await readFile(`${output}/${name}`))
      .digest("hex")}  ${name}`,
  );
await writeFile(`${output}/SHA256SUMS`, sums.join("\n") + "\n");
console.log(`Release assets prepared in ${output}/`);
