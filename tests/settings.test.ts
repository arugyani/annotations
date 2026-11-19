import { test } from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { COLORS } from "../src/model";
import {
  hexColor,
  paletteColors,
  PALETTE_EVENT,
  PRESETS,
  readSettings,
} from "../src/settings";
import { paletteProperties, PaletteStyles } from "../src/palette-styles";

test("legacy and malformed settings get a usable palette without an author field", () => {
  for (const input of [
    null,
    undefined,
    [],
    "Ada",
    {},
    { author: "Ada" },
    { palette: "__proto__", visibleColors: [] },
  ]) {
    assert.deepEqual(readSettings(input), {
      palette: "classic",
      customColors: PRESETS.classic.colors,
      visibleColors: COLORS,
    });
  }
  const settings = readSettings({
    palette: "custom",
    customColors: { blue: " #abcdef ", red: "red;display:none" },
    visibleColors: ["blue", "blue", "unknown"],
  });
  assert.deepEqual(settings.visibleColors, ["blue"]);
  assert.equal(settings.customColors.blue, "#ABCDEF");
  assert.equal(settings.customColors.red, PRESETS.classic.colors.red);
  assert.equal(hexColor("#abc"), undefined);
  assert.equal(hexColor("#abcd12;"), undefined);
});

test("changing presets preserves the saved custom palette", () => {
  const custom = readSettings({
    palette: "custom",
    customColors: { blue: "#123456" },
    visibleColors: ["blue", "green"],
  });
  const earth = readSettings({ ...custom, palette: "earth" });
  assert.deepEqual(paletteColors(earth), PRESETS.earth.colors);
  const restored = readSettings({ ...earth, palette: "custom" });
  assert.equal(paletteColors(restored).blue, "#123456");
  assert.deepEqual(restored.visibleColors, ["blue", "green"]);
});

test("palette overrides contain only validated colors and fixed plugin variable names", () => {
  const properties = paletteProperties(
    readSettings({
      palette: "custom",
      customColors: { yellow: "#123456", blue: "#000000;background:red" },
    }),
  );
  assert.equal(properties["--annotations-yellow-ink"], "#123456");
  assert.equal(properties["--annotations-yellow-tint"], "rgba(18,52,86,.24)");
  assert.equal(
    properties["--annotations-blue-ink"],
    PRESETS.classic.colors.blue,
  );
  assert.equal(Object.keys(properties).length, 12);
  assert.ok(
    Object.values(paletteProperties(readSettings(null))).every(
      (value) => value === "",
    ),
  );
});

test("palette updates reach each owning document and clean up on unload", () => {
  const main = new JSDOM("<!doctype html><body></body>"),
    popout = new JSDOM("<!doctype html><body></body>");
  for (const dom of [main, popout]) {
    (dom.window.HTMLElement.prototype as unknown as HTMLElement).setCssProps =
      function (props) {
        for (const [name, value] of Object.entries(props))
          this.style.setProperty(name, value);
      };
  }
  const first = main.window.document as unknown as Document,
    second = popout.window.document as unknown as Document;
  first.documentElement.style.setProperty("--annotations-blue-ink", "#010203");
  const styles = new PaletteStyles(),
    soft = readSettings({ palette: "soft" });
  let updates = 0;
  first.addEventListener(PALETTE_EVENT, () => updates++);
  styles.apply(first, soft);
  styles.apply(first, soft);
  styles.apply(second, soft);
  assert.equal(updates, 1, "editor updates do not reapply unchanged settings");
  assert.equal(first.querySelector("style"), null);
  assert.equal(
    second.documentElement.style.getPropertyValue("--annotations-blue-ink"),
    PRESETS.soft.colors.blue,
  );
  styles.update(readSettings({ palette: "earth" }));
  assert.equal(updates, 2);
  assert.equal(
    second.documentElement.style.getPropertyValue("--annotations-blue-ink"),
    PRESETS.earth.colors.blue,
  );
  popout.window.dispatchEvent(new popout.window.Event("unload"));
  assert.equal(
    second.documentElement.style.getPropertyValue("--annotations-blue-ink"),
    "",
  );
  styles.destroy();
  assert.equal(
    first.documentElement.style.getPropertyValue("--annotations-blue-ink"),
    "#010203",
  );
  styles.update(soft);
  assert.equal(updates, 2);
  main.window.close();
  popout.window.close();
});
