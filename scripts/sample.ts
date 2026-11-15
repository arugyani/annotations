import { writeFileSync, mkdirSync } from "node:fs";
import { newComment, serialize } from "../src/model";
const root = "sample-vault";
const doc = `# Field notes\n\nA quiet place to review ideas, ask questions, and leave context for the next reader.\n\n## A proposal worth discussing\n\nWe should start with a small pilot before expanding the project. The next review is on Friday.\n\nThis paragraph has **bold text**, *emphasis*, a [reference](https://example.com), and Unicode: café 🌙 你好.\n\n## Details\n\n- First item\n  - A nested item with a question\n- Second item\n\n| Decision | Owner |\n| --- | --- |\n| Pilot | Ada |\n\n\`\`\`js\n// Keep annotations outside this code.\nconst message = '<script> is text';\n\`\`\`\n\nRepeated passage.\n\nA separator with different context.\n\nRepeated passage.\n\n## Long selection\n\n${"A long passage gives a comment enough context to review comfortably. ".repeat(18)}\n`;
const make = (quote: string, body: string, color: any) =>
  newComment(
    doc,
    doc.indexOf(quote),
    doc.indexOf(quote) + quote.length,
    "selection",
    body,
    "Ada",
    color,
  );
const a = make(
  "small pilot",
  "What would success look like after two weeks?",
  "yellow",
);
const b = make(
  "a small pilot before expanding",
  "Agree with the direction. Let’s define the scope before Friday.",
  "blue",
);
const c = make("bold text", "Confirm this wording with the team.", "green");
c.status = "resolved";
const d = make(
  "Repeated passage.",
  "This is the first occurrence, with its own context.",
  "purple",
);
const f = newComment(
  doc,
  0,
  0,
  "file",
  "Review the proposal and capture any open questions here.",
  "Me",
  "purple",
);
writeFileSync(`${root}/Welcome.md`, serialize(doc, [a, b, c, d, f]));
writeFileSync(
  `${root}/Malformed.md`,
  '# Protected fixture\n\nThis file must never be rewritten by Comments.\n\n<!-- obsidian-comments:v1\n{"version": 1, "comments": "broken"}\n-->\n',
);
writeFileSync(
  `${root}/Unsupported.md`,
  "# Future version fixture\n\n<!-- obsidian-comments:v99\n{}\n-->\n",
);
writeFileSync(
  `${root}/Empty.md`,
  "# Fresh note\n\nSelect any word or sentence here to add your first comment.\n",
);
mkdirSync(`${root}/.obsidian`, { recursive: true });
writeFileSync(
  `${root}/.obsidian/community-plugins.json`,
  JSON.stringify(["annotations"]),
);
writeFileSync(
  `${root}/.obsidian/app.json`,
  JSON.stringify({ safeMode: false }),
);

const iceland = `---
coordinates:
  - "64.96"
  - "-19.02"
type: "[[Country]]"
---

Check the coordinates before publishing this country guide.

The final review is on Friday.
`;
const at = iceland.lastIndexOf("coordinates");
writeFileSync(
  `${root}/Iceland.md`,
  serialize(iceland, [
    newComment(
      iceland,
      at,
      at + "coordinates".length,
      "selection",
      "",
      "Me",
      "blue",
    ),
  ]),
);
