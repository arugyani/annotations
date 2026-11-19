import { test } from "node:test";
import assert from "node:assert/strict";
import { newComment } from "../src/model";
import { sidebarPassage } from "../src/sidebar-passage";

function record(source: string, quote: string) {
  const from = source.indexOf(quote);
  return newComment(
    source,
    from,
    from + quote.length,
    "selection",
    "",
    "Me",
    "blue",
  );
}
test("passage preserves exact spaces and keeps surrounding lines out", () => {
  const c = record(
    "Previous paragraph.\nMake a little room for quiet.\nNext paragraph.",
    "little room",
  );
  assert.deepEqual(sidebarPassage(c), {
    before: "Make a ",
    quote: "little room",
    after: " for quiet.",
  });
});
test("native markers are omitted without eating surrounding text", () => {
  const c = record("Make a ==🔵little room== for quiet.", "little room");
  c.native = true;
  assert.deepEqual(sidebarPassage(c), {
    before: "Make a ",
    quote: "little room",
    after: " for quiet.",
  });
});
test("long context is abbreviated at word boundaries and quote stays whole", () => {
  const c = record(
    "A long introduction with several words that need to fit around the highlighted phrase and a long conclusion with several words that also need to fit.",
    "highlighted phrase",
  );
  const p = sidebarPassage(c);
  assert.equal(p.quote, "highlighted phrase");
  assert.ok(p.before.startsWith("… "));
  assert.ok(p.after.endsWith("…"));
  assert.ok(p.before.length <= 49 && p.after.length <= 49);
});
test("file annotations have no passage context", () => {
  const c = record("Some text.", "Some");
  c.kind = "file";
  assert.deepEqual(sidebarPassage(c), {
    before: "",
    quote: "Entire file",
    after: "",
  });
});
