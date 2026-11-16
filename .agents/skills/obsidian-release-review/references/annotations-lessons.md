# Annotations: release lessons

For `arugyani/annotations`. Reviewed November 16, 2026 using tags, surviving commits, archived pre-squash history, `docs/TESTING.md`, and user-supplied review reports. Separate compliance findings from project preferences.

## Compliance and distribution

| Evidence | Finding/change | Reusable check |
| --- | --- | --- |
| 1.0.7 (`991e5fe`) | Unique plugin ID, official lint, settings validation, deferred-view guards, document ownership, render cleanup, host-only bundle audit. | A working UI does not establish release compliance; review APIs, lifecycle, and distribution. |
| 1.0.7 report → 1.0.8 (`5d40735`) | Native DOM creation warnings despite passing local ESLint. | Inspect actual report; use Obsidian helpers without losing pop-out ownership. |
| Same report/fix | CSS `!important` on selected rows, hidden controls, motion, and borders. | Lint CSS separately and verify affected computed states after specificity changes. |
| Same report/fix | ZIP and `SHA256SUMS` were unsupported uploaded assets. | Publish only supported files; keep checksums local. |
| Same report/workflow | Attestation recommendation; job blocked by account billing lock even on a public runner. | Inspect job results. Do not equate checksums with provenance or change billing to satisfy a recommendation. Recheck current account state when relevant. |
| 1.0.9 (`18e5074`) | Draft had no assets. Built, validated, uploaded, downloaded, compared, then published. | Inspect attachments rather than trusting a draft title/tag. |
| 1.0.10 (`16a265d`), math work `1737f5f` | New rendered math introduced an unknown CSS type selector. | Include host-rendered DOM and CSS in feature review. |
| 1.0.11 (`c778c93`) | `mjx-math` warning fixed with `.comments-math-surface` on the same node, removed at cleanup. | Run `selector-type-no-unknown`; check class attachment, matching, highlight bands, and unload. |
| README `689e54b` | “Never tested on mobile” became false after user testing. | Keep claims current; no binary release for text-only corrections. |

The 1.0.7 report passed network-pattern, individual-vault-read, dependency, obfuscation, and byte-for-byte build checks. Historical passes do not certify later code.

## Product regressions when affected

Early hashes below identify archived pre-squash commits and may not be reachable on GitHub. Public verification notes remain in `docs/TESTING.md`.

- 1.0.1 (`645c121`): color selection immediately saves a highlight; note text is optional. Valid metadata stays agent-readable in raw Markdown but hidden without placeholders in rendered notes. Unknown/malformed data remains visible and unmodified. Preserve anchors, Unicode, overlaps, concurrent edits, and undo/redo.
- 1.0.2–1.0.3 (`5a3f25e`, `345b506`): show the pill at the first selected character, not pointer release. Animate after positioning, reuse toolbar DOM as selection grows, and honor both reduced-motion settings.
- 1.0.5 (`8f4a43b`): anchor to the fixed selection endpoint, away from the moving edge. Check upward/downward selection, scrolling, multiline ranges, and collapse.
- 1.0.3–1.0.4 (`345b506`, `de07d54`): no redundant “Me” label or bright leading stripe; icon-only note control retains an accessible name. Tooltip contains note text rather than color/author boilerplate. Preserve search, filters, save/cancel, and keyboard dismissal.
- Motion `27bae9c`: reveal/underline animations must not leave stale state after immediate or batched undo. Recolor without duplicate annotations.
- Math `1737f5f`, `c778c93`: source anchors remain attached while equations stay rendered. Line-based bands align with inline/display equations and scrolling. Remove render classes/variables when no longer needed.
- README/media: concise product-first instructions, plain technical English, cropped editor-plus-panel screenshots, current behavior. Developer storage/installation/test-vault details belong in developer docs for this project; these are not universal directory prohibitions.

## Project conventions

- Read current `docs/RELEASING.md`. Use `npm run package` with `RELEASE_TAG`. Its 128 kB JS budget and host-only bundle checks are local policy, not universal requirements.
- Test only in a dedicated synthetic vault; permission to install in the personal vault does not authorize test writes there. Locate the current test vault instead of embedding a machine-specific path in this skill.
- Prefer Firefox for browser work. Respect active user control rather than fighting tab changes.
- Preserve user Git identity. Do not repeat old history squashes/branch deletions during routine releases.
- Keep Actions optional and respect current resource constraints; maintain the local release path.
