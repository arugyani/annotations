# Development

Use Node.js 24.

```sh
npm ci
npm run package
```

This command checks types, lint rules, formatting, tests, and bundle contents. It creates the release files in `release/<version>/`.

Use a separate Obsidian vault for tests. Test fixtures are in `tests/fixtures/vault`. Copy `main.js`, `styles.css`, and `manifest.json` into that vault's `.obsidian/plugins/annotations` directory. Do not use personal notes for tests.

To reset the test notes, run `node --import tsx scripts/sample.ts`. To create the screenshot note, run `node --import tsx scripts/readme-fixture.ts`.

The app test scripts require an isolated Obsidian instance with a debugging port at `9223`. Open the fixture vault in that instance before you run the scripts. These scripts modify test notes.

- [Release procedure](RELEASING.md)
- [Test results and limits](TESTING.md)
- [Performance measurements](PERFORMANCE.md)
- [File format](FORMAT.md)

## README writing

The README introduces the plugin and explains its basic controls. Use the [ASD-STE100 Issue 9](https://www.asd-ste100.org/assets/files/ASD-STE100_ISSUE9.pdf) writing rules: short sentences, active verbs, one instruction per sentence, and consistent terms. Use *note* for an Obsidian document and *comment* for text added with Annotations. Keep interface labels unchanged. Use the product's technical nouns and computer-process verbs when the general dictionary does not cover them.

The README screenshots are crops of native Obsidian captures. The crop starts at pixel (88, 80) and measures 2312 × 1100 pixels. It excludes the tab bar, ribbon, status bar, and unused space. It preserves the editor and Annotations panel.
