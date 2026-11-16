Fix the community CSS review warning for rendered math.

- Use a plugin-owned class instead of the `mjx-math` CSS type selector.
- Preserve equation highlight alignment and selection previews.
- Remove the class when the highlight is cleared or the plugin unloads.

Requires Obsidian 1.8.7 or later. Existing annotations remain compatible.
