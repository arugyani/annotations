# Verification report


## 1.0.15 release check — November 17, 2026

- Reproduced a composer extending above the editor pane in the synthetic Obsidian vault.
- Verified fixed placement and note saving at 900×380, 500×650, and 500×280. The shortest window uses an internal scrollbar and reserves room above the status bar.
- Added regression coverage for pane-relative placement and reading anchor geometry before the CodeMirror write phase. Existing mobile and rendered-math tests remain included.
- Locked install, TypeScript, ESLint, formatting, tests, build validation, and Stylelint 18.0.0 checks cover the release files.
- The development-only dependency advisory and unavailable attestations recorded for 1.0.14 still apply. No dependency or minimum-version changes are included.



## 1.0.14 release check — November 17, 2026

- Node 24.21.0, locked install; 47 automated checks, TypeScript, ESLint, formatting, build and artifact checks passed.
- Stylelint 18.0.0 passed on source and generated CSS using the release-review configuration.
- Reproduced the persistent mobile dock in the prior browser preview. The fixed preview passed outside-tap dismissal, blur, keyboard dismissal, no reopening on resize, recoloring during note entry, and saving. Checked transparent swatch targets and selected rings in light/dark host styles; desktop hover remains unchanged.
- Installed the packaged files only in the separate synthetic vault. Highlight creation, optional note saving, and plugin disable/re-enable passed with manifest 1.0.14.
- Physical iPhone verification of these fixes remains pending. Browser checks do not reproduce native iOS keyboard behavior.
- Dependency audit: nine high-severity entries trace to development-only picomatch 4.0.7 through the lint toolchain (GHSA-fc5q-39xc-vjpf). No patched version is listed. The plugin bundles only its own source; these dependencies are absent from shipped assets. Do not treat the full dependency audit as clean or apply the suggested toolchain downgrade automatically.
- Artifact attestations remain unavailable under the existing Actions billing restriction. Release files are built and compared locally.


Built and tested November 12, 2026 in an isolated Linux cloud workspace. No pre-existing repository or local instructions were present. pstack was absent from the available skill catalog; the requested fallback workflow was used. The cloud runtime and desktop skills supplied setup guidance.

## Official API references consulted

- [Editor extensions](https://docs.obsidian.md/Plugins/Editor/Editor+extensions), including CodeMirror 6 registration and editor/Reading view responsibilities.
- [Official Obsidian API declarations](https://github.com/obsidianmd/obsidian-api/blob/master/obsidian.d.ts): `registerEditorExtension`, `registerMarkdownPostProcessor`, `editor-menu`, `editor-change`, `Vault.process`, `Editor.replaceRange`, workspace leaves, and views.
- The official [Obsidian releases](https://github.com/obsidianmd/obsidian-releases) supplied the Linux 1.15.1 AppImage used for app checks. The AppImage was extracted and launched with a separate user-data directory and only the dedicated synthetic vault. Desktop access required launching outside the filesystem sandbox; no personal vault was opened.

## Automated engine checks

`npm run check` validates TypeScript. `npm test` runs 34 meaningful tests against the storage model and the actual CodeMirror transaction filter/history implementation:

- Exact source preservation, safe JSON/HTML-comment escaping, and round trips.
- Comment lifecycle persistence and removing the final footer.
- Invalid metadata, unsupported versions, duplicate markers/IDs, and unrelated trailing content refuse writes.
- Conservative external movement, context disambiguation, and deletion of one duplicate without redirecting its annotation to the other copy.
- Inside/before-target edits, overlapping ranges, Unicode offsets, deletion, and manual reattachment primitives.
- Undo/redo restores both source and anchors; lifecycle actions have their own history boundaries.
- Atomic mutation retains concurrent unrelated comment records.
- File, ATX section, and fenced-code scope rules.
- A move without sufficient preserved context deliberately detaches instead of guessing.

The original benchmark of 30 anchor-filter transactions in a 119,490-character document with 100 comments measured approximately 7.25 ms median and 12.35 ms p95 in this Node runtime. This measures transaction processing only, not end-to-end editor rendering or phone performance. See `evidence/benchmark.json` for that historical result. The current, expanded before/after measurements are in [PERFORMANCE.md](PERFORMANCE.md).

## Actual Obsidian checks

`scripts/obsidian-test.mjs` connects to an isolated Obsidian 1.15.1 instance over localhost CDP. It uses synthetic Runtime notes, real plugin commands and dialogs, actual editor buffers and files, and the real renderer. This is not a simulated Obsidian UI.

The existing lifecycle suite passed 20 app checks, including a complete application restart and visible keyboard focus. Checks cover selection creation, literal script-like comment bodies, author/color values, editing, resolve/reopen, filters and empty states, editor range tracking, keyboard undo/redo, close/reopen persistence, target deletion and reattachment, block/section/file commands, file rename, Reading view buttons, external filesystem modifications, and malformed-footer write refusal. The script also checks renderer errors and panel overflow while capturing 1200×900 and 390×844 viewports in light/dark theme classes. Inspect `evidence/runtime-results.json` for the final run’s exact list of passed checks.

Rendered desktop and narrow screenshots were inspected. This found and led to fixes for cramped narrow sidebars, footer-induced undo grouping, and deferred Obsidian leaf handling during layout migration. The interface uses compact rows, quotation rules, and native Obsidian action menus in place of bordered cards and repeated action buttons. Menu editing, reattachment, deletion, resolving/reopening, and keyboard access were verified in the actual app. The release uses a full Comments tab below 650px, collapses side panels, and uses 44px narrow-screen action controls.

Synthetic samples include headings, formatting, links, paragraphs, repeated text, nested lists, a table, fenced code, Unicode, a long passage, overlapping comments, resolved comments, invalid metadata, and an unsupported version. The plugin has no network requests or telemetry.

The optimization pass adds randomized transaction/undo checks, marker-boundary tests, exact verification under rolling-hash collisions, and five real-app cache/scroll checks. See [PERFORMANCE.md](PERFORMANCE.md) for the measured costs, methodology, and retained limitations.

## Remaining limits

- Actual iOS, Android, and tablet hardware were not tested. A narrow Linux viewport does not reproduce Obsidian’s native mobile shell, touch selection, safe-area insets, or mobile keyboard.
- Real multi-device synchronization races were not reproduced. External filesystem edits and atomic read-modify-write behavior were exercised locally. Conflict resolution between whole-file replicas remains the sync provider’s responsibility.
- Exact matching cannot prove semantic identity. With insufficient context the plugin preserves the record and asks for reattachment. Complete paragraph moves and cut/paste in separate transactions can therefore detach.
- Reading-view mapping uses exact single-text-node highlights; all targets remain available in the sidebar. It does not promise pixel-exact inline spans across transformed Markdown, every syntax plugin, or every theme.
- Minimum-version behavior was not run on Obsidian 1.5 itself; real-app evidence is from 1.15.1. Third-party editor/theme compatibility and very large notes with thousands of annotations need broader testing.
- No claims of perfect agent interpretation, exhaustive accessibility auditing, or lossless multi-writer merging are made. See the format’s explicit reading and write-refusal rules.


## Version 1.0.1: folded metadata and selection UI

Verified November 13, 2026 in the dedicated synthetic vault. Valid v1 metadata is replaced visually by a compact block widget in both Source mode and Live Preview. An explicit control/command reveals the raw data. Folding itself changes no stored bytes. Unsupported/malformed metadata remains visible for repair. A preserved editable boundary and guarded user forward-delete keep typing out of the hidden footer; external transactions are still validated normally.

The floating selection pill saves a highlight on a color click. Add note opens an inline plain-text composer; the note is optional, and recoloring/editing keeps the record ID. An empty body uses the existing v1 schema. The inline editor uses an Obsidian keyboard scope only while focused and releases it on blur/close.

- `tests/editor-ui.test.ts`: ten additional checks cover folding ranges, explicit inspection, selection boundaries, malformed data, EOF, deletion protection, recoloring, optional notes, and overlaps. The full automated suite now has 34 passing checks.
- `scripts/selection-ui-checks.mjs`: 17 real-app checks cover mouse dragging, instant colors, inline save/edit/cancel, inert script-like text, raw inspection byte preservation, Ctrl+End/Delete safety, keyboard save, stale-source rejection, close/reopen persistence, both editing modes, and a 390px composer. Results: [selection-results.json](../evidence/selection-results.json).
- `scripts/selection-touch-check.mjs`: four app checks cover a note without a final newline, select-all/delete/undo, disabling/re-enabling with a caret inside metadata, and CDP-emulated touch with 44px controls and text entry. Results: [selection-touch-results.json](../evidence/selection-touch-results.json). This is desktop touch emulation, not physical Android/iOS testing.
- The existing lifecycle, cache/scroll, and app-restart checks were retained and rerun. Updated screenshots were inspected in light/dark and narrow layouts.

The sample vault includes `Iceland.md`, a synthetic frontmatter/coordinates example with a highlight and no note. No personal vault was opened or modified.


## Version 1.0.2: quieter annotation interface

Verified November 14, 2026 with the dedicated synthetic vault in Obsidian 1.15.1 on macOS. The personal vault was not used for test notes.

- `npm run check` and `npm run build` passed. `node --import tsx --test tests/*.test.ts` passed all 34 checks; this invocation avoids the sandbox IPC restriction encountered by the `tsx` CLI wrapper.
- Actual app inspection confirmed no metadata placeholder or counter in Live Preview or Reading view, an icon-only note button in the selection pill, and the redesigned sidebar with open/resolved filtering, search, and Escape dismissal. A dark-theme desktop screenshot was visually inspected.
- The pill and inline composer have a 140ms fade/3px entrance animation. CSS disables it for both `prefers-reduced-motion: reduce` and Obsidian's `is-reduced-motion` class. These rules were source-reviewed; computed-style/animation timing was not independently measured in this run.
- Existing Linux app-check scripts were adapted to the new controls but were not rerun in this macOS session. This run does not add physical mobile, minimum-version, or third-party-theme validation.

Storage and anchor behavior are unchanged. Metadata remains in the raw Markdown for agents; explicit inspection is available through the Show/hide stored comment data command.


## Version 1.0.3: selection motion and simpler rows

Verified November 14, 2026 in the separate synthetic vault on macOS, using Obsidian 1.15.1. Applied the UI SDK skill's popup-state, naming, and interaction-testing guidance plus its cleanup checklist; the plugin continues to use Obsidian/CodeMirror controls.

- `npm run check`, `node --import tsx --test tests/*.test.ts` (35 checks), and `npm run build` passed with exit code 0.
- CodeMirror mounts tooltip DOM offscreen before measuring and positioning it. The entrance now starts from `TooltipView.positioned`, using a persistent class on the existing tooltip. It does not restart as the selection grows. The regression check covers immediate appearance on a one-character selection, reuse during extension, and removal when collapsed.
- In the actual app, DevTools Animations recorded `comments-appear` on the pill. Slowed playback showed partial opacity during the entrance. Under emulated `prefers-reduced-motion: reduce`, a new selection showed the pill and recorded only CodeMirror's caret blink, with no pill animation. Emulation and playback speed were restored.
- Mouse word selection, immediate highlight saving, optional-note opening, disabled empty-note save, and Escape dismissal were exercised in the synthetic note. The final correction preserves immediate appearance during selection, with no pointer-release gate; the state regression was rerun after that correction.
- The sidebar screenshot was inspected: no author label, color dot, or bright leading stripe. Record authorship and note content are preserved. Native mobile hardware and third-party themes were not retested.


## Version 1.0.4: compact note previews

Verified in the separate synthetic vault on Obsidian 1.15.1. Highlights now expose only note text (or "Open highlight") to the native tooltip. `setTooltip` adds a scoped class, 350ms hover delay, and an 8px gap; editor configuration runs on pointerover before Obsidian's delegated tooltip listener. Reading-view marks use the same API.

Typecheck and build passed with exit code 0. All 35 existing engine checks passed. Native Reading-view tooltip rendering was exercised through a pointer event in DevTools: the resulting element had `tooltip comments-note-preview`, the expected body-only text, and a computed 13px font. Its screenshot was visually inspected. The editor labels and click-to-sidebar behavior were checked in the app; the final pointerover event-order correction was source-reviewed and typechecked. Long-text clamping is CSS-limited to six lines with wrapping; the full record remains in the sidebar and Markdown.

Minimum Obsidian version is now 1.8.7, matching the documented introduction of tooltip `classes` and `gap`. No personal note content was used for tests. Physical mobile and third-party themes were not retested.


## Version 1.0.5: stable upward selection

Verified November 14, 2026 in the separate synthetic vault on Obsidian 1.15.1. The selection pill now anchors to the selection's fixed anchor rather than its ordered `from` offset. Backward selections initially place it below the anchor, away from the moving selection head. Immediate appearance, the existing entrance animation, and reduced-motion rules remain unchanged.

A regression check extends forward and backward selections, verifying a stable tooltip anchor and creator while the actual annotation range continues to grow. Typecheck, build, and all 36 engine checks passed.

The supplied recording was inspected. In the actual Obsidian editor, four backward-selection updates before the fix moved the pill through (493,391), (399,391), (304,343), and (700,319). After loading 1.0.5, the same updates held it at (499,467); four forward-selection updates held it at (314,319). Both sequences reused the same toolbar DOM element. Measurements used CodeMirror selection transactions through the app's DevTools, not a physical pointer-drag replay. No personal notes were used for testing; mobile hardware and third-party themes were not retested.


## Version 1.0.6: Annotations name and current screenshots

The displayed plugin name, ribbon, sidebar, README, and download archive names are now Annotations. The plugin ID, installation folder, command IDs, CSS classes, and Markdown format remain unchanged for compatibility. Existing settings and comments need no migration.

Four new README screenshots were captured from Obsidian 1.15.1 on macOS using a separate synthetic vault: the selection pill in light mode, the optional-note composer in dark mode, the dark sidebar, and a 430px-wide desktop window showing the full-tab list. The 1200×850 desktop captures and 430×820 narrow capture are native 2x-resolution images. They were visually inspected. No personal note content appears in the screenshots. The test window and original note were restored after capture.

The screenshot fixture is generated by `node --import tsx scripts/readme-fixture.ts`; an optional directory argument writes the same fixture into a separate test vault. Existing screenshot scripts and older evidence remain historical. These captures do not establish physical mobile compatibility. Typecheck, build, and all 36 engine checks passed for the renamed build.

## Version 1.0.7: release audit

Validated against Obsidian's official plugin guidelines, load-time guide, deferred-view and pop-out guidance, submission requirements, and release workflow guide. The official Obsidian ESLint recommended rules pass with zero warnings. A clean `npm ci` completed and reported zero known dependency vulnerabilities; the patched development-only minimatch override is exercised by lint and formatting checks. All 38 engine/DOM tests pass, including the additional settings-validation and pop-out-document/literal-text checks. The minified bundle contains only project source and external host modules. Both ZIP layouts were inspected, including exclusion of obsolete plugin folders and local settings/workspace files.

Native checks used Obsidian 1.15.1 in the separate synthetic vault. The `annotations` build loaded, the first selection exposed the pill, a blue highlight saved without a note, an optional note saved with Cmd+Enter, and the sidebar reflected its exact text. Reading view displayed the note's highlight. Disabling the plugin removed all Reading-view marks and cleared its four render layers; re-enabling restored the view. A deliberately delayed render completed after unload without adding marks or retaining layers. The searchable author settings rendered in the current settings window. The original test note was restored to Live Preview.

One measured plugin enable (including module loading and host bookkeeping) took 56.9 ms; this is not a cold-start benchmark or a bound for other vaults/devices. The precise minimum app version and physical mobile hardware were not rerun. No personal notes were used in this audit. See [Releasing](RELEASING.md) for the remaining owner-controlled publication and submission steps.

Release validation runs locally with `npm run package`; GitHub Actions is not used or required. The published assets are locally built and checksum-verified, without a claim of hosted CI or provenance attestation.


## Version 1.0.8: community review fixes

Validated in Obsidian 1.15.1 on macOS in the separate synthetic vault. Computed styles confirmed 20px/18px sidebar padding, 8px/10px target padding, colored editor highlights, and hidden search/filter controls. A temporary selected class produced the expected 1px outline. The pill used `comments-appear` normally and `none` with Obsidian's reduced-motion class; that class was restored after the check. The interface was visually inspected. System-level reduced-motion emulation, physical mobile hardware, and third-party themes were not rerun for this version.

The DOM regression models Obsidian helpers in separate main and pop-out documents and checks owner-document adoption, highlight creation, optional-note editing, and literal user text. The release validator rejects CSS `!important`. The release contains only the three supported Obsidian assets; the optional public-runner workflow compares a fresh source build with those assets before attesting them.

After the DOM-helper change, the rebuilt plugin was reloaded in the synthetic vault. A new selection displayed all five color controls and the note icon. The optional composer opened with its empty Save button disabled and closed on Cancel. Reading view rendered three native highlight marks with the expected computed purple, blue, and green colors. The note was returned to Live Preview. All 38 tests, typecheck, official lint, formatting, build, and release checks passed.


## Version 1.0.12: mobile annotation dock

Mobile uses a dock at the bottom of the visible editor, above visible Obsidian formatting or navigation bars. Desktop keeps the existing selection tooltip. The dock reuses the color and optional-note controls and reduced-motion styles. It follows visual viewport resize/scroll events, uses the owning window, and removes its DOM, listeners, observer, and pending frame when the editor is destroyed.

All 46 automated tests, typecheck, official lint, formatting, build, and release metadata checks passed. New regression checks cover mobile/desktop routing, viewport changes, keyboard and host-bar clearance, rotation, active-leaf changes, selection dismissal, and teardown.

A browser preview using the actual editor extensions and plugin CSS verified highlight-only creation, color state, optional note saving and reopening, keyboard dismissal, selection collapse, and a 320px-wide layout without horizontal dock overflow. The preview uses synthetic note content, host chrome, and a simulated keyboard; it is not an Obsidian mobile runtime or a native iOS edit-menu test. Phone testing and a native Obsidian smoke test remain pending for this change. No personal vault was used.


## Version 1.0.13: native mobile styling and text-field clipping

The mobile dock uses Obsidian's touch-size, toolbar-option-width, icon, and raised-surface variables. Colors form a command group with a separate round note action, matching the host mobile toolbar structure. Desktop markup and styles are unchanged.

The first-character clipping was reproduced in a browser preview with the mobile rules from Obsidian 1.15.1's shipped stylesheet: the textarea inherited a 24px radius while the plugin set zero padding. Restoring those two old declarations reproduced the clipped “T” in “Test.” The fix gives the inner mobile textarea square corners and 4px theme-based padding; the outer composer retains its rounded border.

The actual plugin controls were checked in light mode at 393px and dark mode at 320px with the host stylesheet. The toolbar measured 44px high, the note icon 24px, all buttons at least 44px wide/high, and no horizontal dock overflow. Color selection while composing, save, and cancel worked. These are browser checks with a simulated keyboard, not a new physical iOS test. The host stylesheet and preview harness remain local verification inputs, not redistributed plugin assets.
