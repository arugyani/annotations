import { test } from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { mathHighlightBackground } from "../src/math-highlight";

function bounds(
  element: Element,
  left: number,
  top: number,
  width: number,
  height: number,
) {
  element.getBoundingClientRect = () => ({
    left,
    top,
    width,
    height,
    right: left + width,
    bottom: top + height,
    x: left,
    y: top,
    toJSON() {},
  });
}
test("aligned bands exclude cell padding and follow each line's content width", () => {
  const document = new JSDOM(
    `<div><mjx-math><mjx-mtable><mjx-table><mjx-itable><mjx-mtr><mjx-mtd><mjx-mi>a</mjx-mi><mjx-tstrut></mjx-tstrut></mjx-mtd></mjx-mtr><mjx-mtr><mjx-mtd><mjx-mi>b</mjx-mi><mjx-tstrut></mjx-tstrut></mjx-mtd></mjx-mtr></mjx-itable></mjx-table></mjx-mtable></mjx-math></div>`,
  ).window.document;
  const wrapper = document.querySelector("div")!;
  bounds(wrapper, 100, 100, 800, 100);
  const symbols = document.querySelectorAll("mjx-mi");
  bounds(symbols[0], 150, 110, 120, 30);
  bounds(symbols[1], 150, 150, 50, 15);
  const background = mathHighlightBackground(wrapper);
  assert.ok(background.includes("49.00px 9.00px / 122.00px 32.00px"));
  assert.ok(background.includes("49.00px 49.00px / 52.00px 17.00px"));
  assert.ok(!background.includes("800.00px"));
});
test("nested notation remains one continuous band and pending math has none", () => {
  const document = new JSDOM(
    `<div><mjx-math><mjx-mrow><mjx-mtable></mjx-mtable></mjx-mrow></mjx-math></div>`,
  ).window.document;
  const wrapper = document.querySelector("div")!;
  bounds(wrapper, 0, 0, 800, 100);
  bounds(document.querySelector("mjx-math")!, 200, 10, 180, 60);
  assert.ok(
    mathHighlightBackground(wrapper).includes(
      "199.00px 9.00px / 182.00px 62.00px",
    ),
  );
  wrapper.replaceChildren();
  assert.equal(mathHighlightBackground(wrapper), "none");
});
