# Performance

Annotations 1.0.8, measured November 15, 2026 on Linux with Node.js 24.22.1 and Obsidian 1.15.1.

| Workload | Note characters | Comments | Median | p95 |
| --- | ---: | ---: | ---: | ---: |
| Engine: unannotated edit | 119,490 | 0 | 0.08 ms | 0.22 ms |
| Engine: typical edit | 119,490 | 100 | 0.14 ms | 1.09 ms |
| Engine: dense edit | 1,008,890 | 500 | 0.51 ms | 4.90 ms |
| Engine: long-selection edit | 119,490 | 40 | 0.74 ms | 2.03 ms |
| Obsidian editor dispatch | 119,490 | 100 | 3.00 ms | 5.90 ms |
| Warm plugin enable | 119,490 | 100 | 44.00 ms | 71.10 ms |

Five runs: 500 samples per engine workload, 350 editor dispatches, and 25 warm enables. App measurements used one open editor with GPU disabled. Dispatch timings exclude full keypress-to-paint latency; warm enable excludes cold app startup.

Installed size: **50.6 kB** across `main.js`, `styles.css`, and `manifest.json`.
