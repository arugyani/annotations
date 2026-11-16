# Obsidian review checklist

Baseline reviewed November 16, 2026. Refresh relevant official sources; this guide does not replace the current community report.

## Manifest and distribution

- Match the default-branch manifest, release manifest, plain `x.y.z` tag, package/lockfile versions where used, and `versions.json` compatibility entry. Verify the tag's commit is the source actually built.
- At initial submission, check ID uniqueness and current naming rules. Do not casually rename an established ID: installation-folder, settings, and storage compatibility may require migration.
- Derive `minAppVersion` from APIs actually used, not just the installed SDK. Annotations' tooltip options needed 1.8.7; that number is not universal.
- Check runtime imports against `isDesktopOnly`. Node-based build/test tools do not by themselves make a plugin desktop-only.
- Check license, concise manifest description, README, and required disclosures. The README should explain purpose and first use early. Privacy, network, outside-vault access, compatibility, and device claims must match current implementation and evidence.
- Attach `main.js`, `manifest.json`, and `styles.css` when used. Exclude uploaded ZIPs, sample vaults, checksums, and release notes. Check empty drafts. Publish a regular release with accessible source; do not replace immutable release history for later fixes.

Sources: [submission](https://docs.obsidian.md/plugins/releasing/submit-plugin), [plugin requirements](https://docs.obsidian.md/community-directory/submission-requirements-for-plugins), [manifest](https://docs.obsidian.md/Reference/Manifest).

## Source, lifecycle, data, startup

- Run [Obsidian's ESLint plugin](https://github.com/obsidianmd/eslint-plugin) on applicable source and manifest files. Review scanner findings even if local lint passes: versions and inference can differ.
- Prefer Obsidian DOM helpers (`createEl`, `createDiv`, `createSpan`, `createSvg`). Render user note text literally rather than injecting HTML.
- Preserve the owning document when constructing/querying controls. If a global helper creates a detached node, adopt it into the intended document where needed. Use owner-window constructors or cross-window instance helpers. Do not fix lint by reverting to main-window globals.
- Validate synced/plugin settings. Use supported vault/editor APIs and atomic changes for concurrent edits. Refuse to overwrite malformed/unsupported annotation data.
- Guard deferred views before assuming a concrete type. Reveal/load when needed; do not eagerly load all leaves to bypass deferral.
- Keep startup and view constructors light. Defer suitable work until layout readiness; avoid startup vault scans/network work. A measured warm enable time is not a cold-start guarantee.
- Dispose observers, listeners, animation frames, key scopes, render children, and DOM decorations. Check unload with pending async work: late completion must not recreate marks or retain layers. Re-enable must not duplicate handlers.
- Review runtime dependencies, vulnerability findings, licensing, network calls, outside-vault access, and readable source. Check current prohibitions on client telemetry, self-install/update mechanisms, and advertising. Disclose required accounts/payment, network services, outside-vault access, and permitted server telemetry where applicable. Minification differs from obfuscation. Legitimate individual-vault reads are not a policy violation; apply actual disclosure requirements.

Sources: [load time](https://docs.obsidian.md/plugins/guides/load-time), [pop-outs](https://docs.obsidian.md/plugins/guides/pop-out-windows), [deferred views](https://docs.obsidian.md/plugins/guides/defer-views), [developer policies](https://docs.obsidian.md/community-directory/developer-policies).

## CSS and interface

- Run separate CSS checks: TypeScript/ESLint did not catch the historical CSS findings.
- Replace `!important` with scoped selectors/variables. Verify affected computed styles: hidden controls, selected rows, target buttons, highlights, narrow layouts, high-contrast borders. A syntactically valid selector can still fail to match.
- Avoid unknown custom-element type selectors in plugin CSS. For MathJax, target a plugin-owned class on the precise node and remove it on cleanup. Do not broaden to all descendants or disable the lint rule. JS locating a host element by tag is distinct from a CSS type selector.
- Scope rules and prefer theme variables. Check light/dark contrast when changing colors.
- Respect both system reduced-motion preferences and Obsidian's reduced-motion state. Verify controls remain usable without animation after specificity changes.
- Preserve keyboard focus, accessible names on icon-only controls, touch targets, and optional-note behavior. A narrow desktop screenshot is not physical mobile testing.

These were community review warnings, not necessarily hard installation blocks. Classify severity from the actual report.

## Verification and release claims

- Install the lockfile with the declared runtime; run the repository release pipeline. Inspect generated bundle imports/inputs; avoid duplicate host Obsidian/CodeMirror copies. Project bundle budgets are not universal Obsidian limits.
- Build tagged source; compare downloaded assets byte-for-byte. Attestation is separate: [GitHub provenance guidance](https://docs.github.com/en/actions/how-tos/secure-your-work/use-artifact-attestations/use-artifact-attestations).
- Use a dedicated synthetic vault and verify its path before mutation. Check changed paths through Live Preview/Reading view, persistence, undo/redo, filtering, reload, motion, or pop-outs as relevant.
- Record app/device versions and actual scope. Credit user-reported mobile testing without claiming universal device support or falsely saying mobile has never been tested.
- Re-run affected checks after fixes; broaden only for new changes or unresolved risks. Report checks that could not be performed.
