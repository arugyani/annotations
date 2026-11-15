# Performance

The tables below document the version 1.0.0 optimization pass. Version 1.0.1 adds folded metadata and the selection pill; its separate app measurement is [performance-app-1.0.1.json](../evidence/performance-app-1.0.1.json). The anchor engine and bounded reading caches remain in place.

Measured on November 12, 2026 in the isolated Linux workspace, against commit `533f98ca2c6851c4d6d13891907e4b5e09ac0e10`. Both versions use the same synthetic workloads and Obsidian 1.15.1 installation. These are measurements from this machine, not a guarantee for other hardware or mobile devices.

## Actual Obsidian editor

The 119,490-character note has 100 comments. `scripts/performance-app.mts` measures 70 synchronous editor dispatches after 10 warmups. It includes the editor transaction and synchronous view update; it excludes transport time and does **not** measure complete keypress-to-paint latency.

| Measurement | Before | After |
| --- | ---: | ---: |
| Median edit dispatch | 12.50 ms | 3.60 ms |
| p95 edit dispatch | 16.90 ms | 7.30 ms |
| p99 edit dispatch | 18.40 ms | 16.60 ms |
| Sidebar mutation records after a prefix-only edit | 1,322 | 0 |
| Search control and focus preserved | No | Yes |
| Median warm plugin enable, five samples | 71.00 ms | 51.70 ms |

Warm enable includes attaching to the already open synthetic editors. It is not a cold app-launch measurement. The same app process was used for before/after checks; JIT, garbage collection, and host scheduling affect the tails. The baseline compiled plugin was reloaded for the before measurement, then the optimized build was restored.

## Anchor engine

`scripts/benchmark.ts` measures CodeMirror state transactions, including realization of the annotation state field. There are 100 samples per scenario after 10 warmups. Edits alternate between the beginning and end of the source. Initialization and quote matching are measured separately from typing.

| Workload | Source characters | Comments | Median ms, before → after | p95 ms, before → after |
| --- | ---: | ---: | ---: | ---: |
| unannotated | 119,490 | 0 | 0.23 → 0.16 | 2.36 → 0.39 |
| typical | 119,490 | 100 | 5.94 → 0.32 | 14.38 → 2.55 |
| dense | 1,008,890 | 500 | 197.35 → 1.15 | 252.47 → 9.35 |
| long selections | 119,490 | 40 | 3.69 → 0.78 | 10.16 → 2.62 |

In the dense workload, annotation initialization measured 202.17 → 40.93 ms. This is a single initialization sample in each benchmark process, with source text already in memory; it is not a disk-load or cold-start average. The p99 values and raw samples' summary are retained in the JSON reports. Dense/long-selection tails can still exceed a frame budget; the readable footer and atomic undo behavior are retained.

## What changed

- **One validated state per immutable editor document.** Normal typing maps known anchors without reparsing JSON or searching every quotation. Opening a file, external replacements, and direct metadata changes still validate and conservatively rematch.
- **No full source flattening for ordinary typing.** Range and context reads use CodeMirror's text tree. Marker validation checks changed regions, including arbitrary whitespace, and prepared state is checked against the final transaction so other editor extensions cannot make it stale.
- **Mapped highlights.** Decoration ranges map through edits. Scrolling reuses the existing decoration set and annotation state.
- **Less footer work.** Edits outside all targets and their contexts leave footer bytes untouched. Required metadata updates stay in the same undoable transaction as the text.
- **Faster initial matching for large sets.** Similar-length contextual signatures share rolling scans with an 8 KiB candidate filter. Hash matches are always verified against exact text; collisions cannot establish an attachment. Small/irregular sets use native string searches. Duplicate signatures share matching work.
- **Stable sidebar DOM.** Rows are keyed by comment ID and rebuilt only when visible content changes. Offset-only edits update the record references without replacing controls or moving keyboard focus. Unrelated vault edits and hidden views do not rebuild the panel.
- **Shared Reading-view work.** Concurrent sections share one pending read, validation, matching pass, and lazy line-offset index. An LRU retains at most four reading documents; vault modifications/deletions/renames invalidate entries. Editor caches use weak keys and disappear with their editor/state. Cache memory still depends on individual note size.
- **Small distribution.** The JavaScript bundle is minified, 30,768 → 27,741 bytes. The stylesheet is minified separately from its readable `src/styles.css` source, 5,067 → 4,918 bytes. Obsidian and CodeMirror remain host-provided; no runtime dependency or network service was added.

The installable zip is 11,737 bytes (10,770 bytes before this pass) and contains only `main.js`, `styles.css`, and `manifest.json`. The extra cache/index code trades a small amount of compressed distribution size for the measured CPU savings; minification reduces uncompressed parsing weight. Development packages, screenshots, and benchmark fixtures are not installed with the plugin.

## Integrity and regression checks

`npm test` passes 24 checks, including 400 randomized edits and undo/redo, malformed/unsupported footers, marker creation across long Unicode whitespace, a later editor filter modifying prepared transactions, copied passages, overlapping ranges, and deliberately colliding rolling hashes.

The real-app checks cover the complete lifecycle, persistence, external edits, keyboard access, light/dark themes, and narrow layouts. `scripts/performance-check.mjs` additionally verifies shared concurrent reads, invalidation, LRU eviction, no UI mutation for unrelated notes, and stable annotation state during scrolling. No personal vault was used.

Reports:

- [Engine before](../evidence/performance-before.json) and [engine after](../evidence/performance-after-engine.json)
- [Obsidian before](../evidence/performance-app-before.json) and [Obsidian after](../evidence/performance-app-after.json)
- [Cache/scroll checks](../evidence/performance-checks.json) and [app lifecycle checks](../evidence/runtime-results.json)

To reproduce the engine workload, run `npx tsx scripts/benchmark.ts`. For app benchmarks, start an isolated Obsidian instance with only the dedicated test vault and localhost debugging port `9223`, then run `npx tsx scripts/performance-app.mts after` and `node scripts/performance-check.mjs`. The app scripts create/reset named synthetic Performance notes; never run them against a personal vault. To reproduce the baseline, use the referenced commit's plugin build with the same benchmark driver. Physical mobile devices, cold app launch, sustained power usage, and long-session heap growth were not measured.


## Version 1.0.1 UI follow-up

The folded footer and selection pill are additions to the earlier optimization pass, so the historical bundle sizes above are not the current release's sizes. The anchor engine still uses the same cached state/mapped ranges, and selection controls are created only for a nonempty document selection. No dependency was added. The current app report is [performance-app-1.0.1.json](../evidence/performance-app-1.0.1.json); this run measured 5.5 ms median and 8.2 ms p95 synchronous edit dispatch in the 100-comment workload. It retains the same caveats about host scheduling, JIT, transport, and paint latency.
