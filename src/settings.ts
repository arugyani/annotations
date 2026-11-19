import { COLORS, type Color } from "./model";

export const PRESETS = {
  classic: {
    name: "Classic",
    colors: {
      yellow: "#A47B12",
      blue: "#428DCC",
      green: "#39936B",
      purple: "#9866C4",
      red: "#D06369",
      orange: "#C87932",
    },
  },
  soft: {
    name: "Soft",
    colors: {
      yellow: "#B68C3F",
      blue: "#6A95B5",
      green: "#6D9B80",
      purple: "#9D83B0",
      red: "#BE7F84",
      orange: "#C89564",
    },
  },
  earth: {
    name: "Earth",
    colors: {
      yellow: "#A17E32",
      blue: "#587F91",
      green: "#6C824C",
      purple: "#8C718B",
      red: "#AD6E5A",
      orange: "#B68046",
    },
  },
} satisfies Record<string, { name: string; colors: Record<Color, string> }>;
export type Palette = keyof typeof PRESETS | "custom";
export interface AnnotationSettings {
  palette: Palette;
  customColors: Record<Color, string>;
  visibleColors: Color[];
}
export function hexColor(value: unknown): string | undefined {
  return typeof value === "string" && /^#[\da-f]{6}$/i.test(value.trim())
    ? value.trim().toUpperCase()
    : undefined;
}
/** Old, hand-edited, and synced settings never introduce CSS or unknown slots. */
export function readSettings(value: unknown): AnnotationSettings {
  const data =
    value && typeof value === "object"
      ? (value as Record<string, unknown>)
      : {};
  const palette =
    typeof data.palette === "string" &&
    ["classic", "soft", "earth", "custom"].includes(data.palette)
      ? (data.palette as Palette)
      : "classic";
  const custom =
    data.customColors && typeof data.customColors === "object"
      ? (data.customColors as Record<string, unknown>)
      : {};
  const customColors = { ...PRESETS.classic.colors };
  for (const color of COLORS)
    customColors[color] =
      hexColor(custom[color]) ?? PRESETS.classic.colors[color];
  const visibleColors = COLORS.filter(
    (color) =>
      Array.isArray(data.visibleColors) && data.visibleColors.includes(color),
  );
  return {
    palette,
    customColors,
    visibleColors: visibleColors.length ? visibleColors : [...COLORS],
  };
}
export function paletteColors(
  settings: AnnotationSettings,
): Record<Color, string> {
  return settings.palette === "custom"
    ? settings.customColors
    : PRESETS[settings.palette].colors;
}
export const PALETTE_EVENT = "annotations-palette-change";
