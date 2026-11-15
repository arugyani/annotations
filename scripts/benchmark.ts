import { EditorState } from "@codemirror/state";
import * as editor from "../src/editor";
import { newComment, parse, reconcile, serialize } from "../src/model";
import { statSync } from "node:fs";
import { benchmarkMetadata } from "./benchmark-metadata.mjs";
const scenarios = [
  { name: "unannotated", lines: 1800, count: 0, length: 14 },
  { name: "typical", lines: 1800, count: 100, length: 14 },
  { name: "dense", lines: 15000, count: 500, length: 14 },
  { name: "long selections", lines: 1800, count: 40, length: 3500 },
];
const percentile = (a: number[], p: number) =>
  a.slice().sort((x, y) => x - y)[
    Math.min(a.length - 1, Math.floor(a.length * p))
  ];
const results = [];
for (const spec of scenarios) {
  const doc = Array.from(
    { length: spec.lines },
    (_, i) =>
      `Paragraph ${i}: synthetic content for responsiveness measurement.\n\n`,
  ).join("");
  const records = Array.from({ length: spec.count }, (_, i) => {
    const at = doc.indexOf(
      `Paragraph ${Math.floor((i * spec.lines) / Math.max(spec.count, 1))}:`,
    );
    return newComment(
      doc,
      at,
      Math.min(doc.length, at + spec.length),
      "selection",
      "A short note",
      "Test",
      "yellow",
    );
  });
  const raw = serialize(doc, records);
  let state: EditorState;
  const start = performance.now();
  state = EditorState.create({ doc: raw, extensions: [editor.anchorFilter] });
  const field = (editor as any).annotationState;
  if (field) state.field(field);
  else reconcile(parse(state.doc.toString()));
  const loadMs = performance.now() - start;
  const samples = [];
  for (let i = 0; i < 110; i++) {
    const at = i % 3 === 0 ? 10 : doc.length - 10;
    const t = performance.now();
    state = state.update({ changes: { from: at, insert: "a" } }).state;
    if (field) state.field(field);
    const ms = performance.now() - t;
    if (i >= 10) samples.push(ms);
  }
  results.push({
    scenario: spec.name,
    documentCharacters: doc.length,
    comments: spec.count,
    rawCharacters: raw.length,
    loadMs,
    medianMs: percentile(samples, 0.5),
    p95Ms: percentile(samples, 0.95),
    p99Ms: percentile(samples, 0.99),
    dispatchMs: samples,
  });
}
console.log(
  JSON.stringify(
    {
      ...benchmarkMetadata(),
      warmupDispatches: 10,
      samplesPerScenario: 100,
      mainBytes: statSync("main.js").size,
      results,
    },
    null,
    2,
  ),
);
