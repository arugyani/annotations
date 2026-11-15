Highlights and optional notes for selections, blocks, sections, and entire Markdown files.

- An immediate selection pill with five colors, an optional note editor, and reduced-motion support.
- Stable positioning when selecting upward or downward.
- A compact sidebar with search, color filters, resolve/reopen, and target navigation.
- Notes stored directly in a labeled Markdown footer, hidden while rendering in Obsidian and readable by other tools.
- Compact hover previews, lifecycle cleanup, and controls created in their editor's window.
- Validated builds, compatibility metadata, checksums, and locally built installation packages.

Requires Obsidian 1.8.7 or later. Runtime checks used Obsidian 1.15.1; physical mobile devices have not been verified.

### Updating from an early manual build

The plugin ID is now `annotations`; the old `comments` ID belongs to another community plugin. Disable the early Annotations/Comments build, install this release into `.obsidian/plugins/annotations`, then enable Annotations. If needed, copy `data.json` from your early build to preserve the default author and reassign hotkeys. Do not enable both builds simultaneously. The Markdown format has not changed and needs no migration.
