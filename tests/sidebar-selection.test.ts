import { test } from "node:test";
import assert from "node:assert/strict";
import { SidebarSelection } from "../src/sidebar-selection";

test("selection toggles individual items and supports forward/backward ranges", () => {
  const selection = new SidebarSelection(),
    visible = ["a", "b", "c", "d"];
  selection.toggle("b", visible);
  selection.toggle("d", visible, true);
  assert.deepEqual([...selection.ids], ["b", "c", "d"]);
  selection.clear();
  selection.toggle("d", visible);
  selection.toggle("b", visible, true);
  assert.deepEqual([...selection.ids].sort(), ["b", "c", "d"]);
  selection.toggle("c", visible);
  assert.deepEqual([...selection.ids].sort(), ["b", "d"]);
});
test("select all and filter changes never retain hidden or missing annotations", () => {
  const selection = new SidebarSelection();
  selection.all(["a", "b", "c"]);
  selection.retain(["b", "d"]);
  assert.deepEqual([...selection.ids], ["b"]);
  selection.toggle("hidden", ["b", "d"]);
  assert.deepEqual([...selection.ids], ["b"]);
  selection.all(["b", "d"]);
  assert.deepEqual([...selection.ids], ["b", "d"]);
  selection.retain([]);
  assert.equal(selection.ids.size, 0);
});
test("clear keeps selection mode; exit resets its range anchor and mode", () => {
  const selection = new SidebarSelection();
  selection.toggle("a", ["a", "b", "c"]);
  selection.clear();
  assert.equal(selection.active, true);
  selection.toggle("c", ["a", "b", "c"], true);
  assert.deepEqual([...selection.ids], ["c"]);
  selection.exit();
  assert.equal(selection.active, false);
  assert.equal(selection.ids.size, 0);
});
