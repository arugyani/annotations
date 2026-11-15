Fixes for the Obsidian community review.

- Use Obsidian DOM helpers for annotation controls while preserving pop-out document ownership.
- Use scoped CSS selectors instead of `!important` overrides.
- Keep highlights, selected comments, hidden controls, and high-contrast borders correctly styled.
- Disable entrance animations when system or Obsidian reduced-motion settings are active.
- Attach only `main.js`, `manifest.json`, and `styles.css` to the release.

Use Obsidian 1.8.7 or later. Existing annotations remain compatible.
