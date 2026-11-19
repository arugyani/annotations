import { COLORS } from "./model";
import {
  PALETTE_EVENT,
  paletteColors,
  readSettings,
  type AnnotationSettings,
} from "./settings";

/** Fixed names and validated values keep custom colors scoped to Annotations. */
export function paletteProperties(
  value: AnnotationSettings,
): Record<string, string> {
  const settings = readSettings(value),
    colors = paletteColors(settings);
  const properties: Record<string, string> = {};
  for (const color of COLORS) {
    const hex = colors[color];
    const rgb = [1, 3, 5].map((offset) =>
      parseInt(hex.slice(offset, offset + 2), 16),
    );
    properties[`--annotations-${color}-ink`] =
      settings.palette === "classic" ? "" : hex;
    properties[`--annotations-${color}-tint`] =
      settings.palette === "classic" ? "" : `rgba(${rgb.join(",")},.24)`;
  }
  return properties;
}
/** Dynamic variables use the owning document; all CSS rules live in styles.css. */
export class PaletteStyles {
  private documents = new Map<
    Document,
    { settings: AnnotationSettings; cleanup: () => void }
  >();
  apply(document: Document, settings: AnnotationSettings) {
    let entry = this.documents.get(document);
    if (entry?.settings === settings) return;
    const root = document.documentElement;
    const properties = paletteProperties(settings);
    if (!entry) {
      const previous = Object.fromEntries(
        Object.keys(properties).map((name) => [
          name,
          root.style.getPropertyValue(name),
        ]),
      );
      const cleanup = () => {
        root.setCssProps(previous);
        document.defaultView?.removeEventListener("unload", cleanup);
        this.documents.delete(document);
      };
      document.defaultView?.addEventListener("unload", cleanup);
      entry = { settings, cleanup };
      this.documents.set(document, entry);
    }
    entry.settings = settings;
    root.setCssProps(properties);
    document.dispatchEvent(new document.defaultView!.Event(PALETTE_EVENT));
  }
  update(settings: AnnotationSettings) {
    for (const document of this.documents.keys())
      this.apply(document, settings);
  }
  destroy() {
    for (const entry of this.documents.values()) entry.cleanup();
  }
}
