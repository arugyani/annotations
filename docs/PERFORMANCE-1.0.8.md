# Performance: 1.0.8

Measured November 15, 2026 against unmodified plugin source at `5d407351b435b7d2b9456602829b7c1ec9038d36`. Benchmark tooling and documentation changed for this report; plugin code and the release version did not. All work ran locally. No GitHub Actions jobs were started and no release assets were replaced.

## Environment and method

Linux 6.18.57, x64, AMD EPYC 9V74 host, five visible logical CPUs with a four-CPU cgroup quota, Node.js 24.22.1. The native app was Obsidian 1.15.1 / Electron 43.8.9 / Chromium 150.0.7871.250 on an Xorg dummy display, with GPU disabled and a 1280 × 900 window. Only Annotations was enabled as a community plugin. This shared virtual machine does not represent mobile hardware or a typical laptop.

The engine workload retains the historical four scenarios, insertion positions, and fixed scenario order. Five separate Node processes each discard 10 warmup transactions and retain 100 samples per scenario. Summary percentiles pool those 500 samples. Initialization has only five samples per scenario; the table gives its median and full range, not a claimed cold-start percentile.

The native-app workload uses five runs in one app process. Each run creates exactly one fresh Markdown editor, opens the sidebar with all 100 comments, and verifies that the installed three assets match the local build hashes. It discards 10 warmups and retains 70 synchronous editor dispatches. Five enable/disable cycles per run yield 25 warm-enable samples. Timing workloads run sequentially. The app test modifies synthetic notes only.

## Editor measurements

| Workload | Source characters | Comments | Median dispatch | p95 | p99 | Maximum |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Engine: unannotated | 119,490 | 0 | 0.08 ms | 0.22 ms | 0.89 ms | 0.97 ms |
| Engine: typical | 119,490 | 100 | 0.14 ms | 1.09 ms | 1.61 ms | 2.20 ms |
| Engine: dense | 1,008,890 | 500 | 0.51 ms | 4.90 ms | 5.92 ms | 35.19 ms |
| Engine: long selections | 119,490 | 40 | 0.74 ms | 2.03 ms | 2.84 ms | 3.20 ms |
| Native Obsidian editor | 119,490 | 100 | 3.00 ms | 5.90 ms | 9.40 ms | 15.00 ms |

Engine timings include CodeMirror state transactions and realization of annotation state, without a DOM. Native timings include the editor transaction and synchronous view update. Neither measures full keypress-to-paint latency, asynchronous sidebar refresh, disk persistence, or transport time. A dense-engine outlier exceeded a 16.7 ms frame budget; low medians do not establish a worst-case latency bound.

| Engine initialization | Median | Range |
| --- | ---: | ---: |
| Unannotated | 2.96 ms | 2.76–3.84 ms |
| Typical | 4.27 ms | 3.73–4.70 ms |
| Dense | 29.45 ms | 27.92–32.15 ms |
| Long selections | 3.10 ms | 2.91–3.16 ms |

Source text is already in memory for initialization. This is not file-open time or cold app startup.

Warm enable measured **44.0 ms median, 71.1 ms p95, 73.6 ms maximum** with one annotated note open. It includes Obsidian's plugin loader, extension registration, and attachment to the open editor. It does not measure cold launch or predict performance with many open editors.

## Sidebar and cache behavior

All five runs preserved the first comment row, the search input, and search focus after a prefix-only edit. There were **zero mutations inside comment rows**, but **11 mutations in the panel controls** in every run's 300 ms observation window. Count text, status attributes, and filter-summary controls are rewritten by `syncControls`. The historical statement that a prefix edit produces zero total sidebar mutations no longer describes this version. Avoiding unchanged control writes is a remaining optimization opportunity.

The separate cache/scroll checks passed:

- Fifty concurrent requests share one file read and one validated snapshot.
- External modification invalidates cached content.
- The reading cache evicts entries beyond four notes.
- Unrelated note edits produce no mutations in the active panel.
- Editor scrolling preserves the annotation snapshot.

## Distribution weight

| Asset | Installed bytes | Individually gzipped bytes |
| --- | ---: | ---: |
| `main.js` | 41,067 | 13,763 |
| `styles.css` | 9,228 | 2,255 |
| `manifest.json` | 301 | 209 |
| Total | 50,596 | 16,227 |

Gzip numbers measure each asset separately, not a release archive. There are no bundled runtime dependencies; Obsidian and CodeMirror are host-provided. Hashes are retained in every run and the summary. The historical 27,741-byte JavaScript bundle predates the current UI and is not the 1.0.8 bundle size.

## Harness correction and limits

Exploratory reruns exposed a flaw in the previous app harness: it could leave multiple editors of `Performance.md` open and then select the first, hidden editor while the sidebar read another editor. That setup produced inconsistent sidebar observations and warm-enable times as high as 5.88 seconds. These observations are retained in [exploratory runs](../evidence/performance-exploratory-1.0.8.json), with a separate [instrumented reload diagnostic](../evidence/performance-enable-diagnostic-1.0.8.json). They are excluded from the controlled single-editor summary. Multiple open editors remain a distinct, uncharacterized workload; this report does not establish the root cause of every exploratory reload delay.

The corrected harness closes existing Markdown leaves, creates one fresh editor, and asserts its count and visible comment count before measuring. It uses the current search control, waits for focus changes before observing prefix edits, retains raw dispatch samples, and captures actual runtime versions and asset hashes. The summary generator refuses mixed builds and uncontrolled editor counts.

Historical reports used different runtime versions and less repetition. These results are a current baseline, not proof of a percentage speedup over those reports. Cold startup, end-to-end paint latency, many-editor scaling, physical mobile devices, power usage, and long-session heap growth were not measured.

## Reproduce locally

Use Node.js 24 and the manual build path:

```sh
npm ci
npm run package
for run in 1 2 3 4 5; do
  node --import tsx scripts/benchmark.ts > "evidence/performance-engine-1.0.8-run$run.json"
done
```

Install the three locally built assets into `tests/fixtures/vault/.obsidian/plugins/annotations/`. Open only this synthetic vault in a separate Obsidian profile with a debugging port at `9223`. Enable Annotations, set a 1280 × 900 window, and run the commands sequentially:

```sh
for run in 1 2 3 4 5; do
  node --import tsx scripts/performance-app.mts after "1.0.8-run$run"
done
node scripts/performance-check.mjs 1.0.8
node scripts/benchmark-report.mjs
```

For a later version, use its manifest version in output labels. `benchmark-report.mjs` reads that version automatically and expects five matching engine and app reports. Git metadata is required. Never run the app scripts against personal notes. No workflow dispatch, hosted runner, version bump, or release publication is needed for these measurements.

## Evidence

- [Pooled summary](../evidence/performance-summary-1.0.8.json)
- Engine runs: [1](../evidence/performance-engine-1.0.8-run1.json), [2](../evidence/performance-engine-1.0.8-run2.json), [3](../evidence/performance-engine-1.0.8-run3.json), [4](../evidence/performance-engine-1.0.8-run4.json), [5](../evidence/performance-engine-1.0.8-run5.json)
- Native app runs: [1](../evidence/performance-app-1.0.8-run1.json), [2](../evidence/performance-app-1.0.8-run2.json), [3](../evidence/performance-app-1.0.8-run3.json), [4](../evidence/performance-app-1.0.8-run4.json), [5](../evidence/performance-app-1.0.8-run5.json)
- [Cache and scroll checks](../evidence/performance-checks-1.0.8.json)
