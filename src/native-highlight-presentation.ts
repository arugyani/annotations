/** Mark only host syntax next to plugin-owned native highlights. CSS stays
 * local; observing the rendered editor avoids document-wide relational rules. */
export class NativeHighlightPresentation {
  private observer: MutationObserver;
  private frame = 0;
  private destroyed = false;
  private owned = new Map<Element, string>();
  private window: Window;

  constructor(private root: HTMLElement) {
    this.window = root.ownerDocument.defaultView!;
    this.observer = new root.ownerDocument.defaultView!.MutationObserver(
      this.schedule,
    );
    this.observer.observe(root, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ["class"],
    });
    this.schedule();
  }

  schedule = () => {
    if (this.destroyed || this.frame) return;
    this.frame = this.window.requestAnimationFrame(() => {
      this.frame = 0;
      this.sync();
    });
  };

  private sync() {
    const next = new Map<Element, string>();
    const previous = (element: Element) => {
      const sibling = element.previousElementSibling;
      return sibling?.classList.contains("cm-widgetBuffer")
        ? sibling.previousElementSibling
        : sibling;
    };
    for (const mark of this.root.querySelectorAll(".comments-native")) {
      const surface = mark.parentElement;
      if (!surface?.classList.contains("cm-highlight")) continue;
      next.set(surface, "comments-native-surface");
      const widget = previous(surface);
      if (widget?.classList.contains("cm-highlight-color-widget")) {
        next.set(widget, "comments-native-syntax");
        const opening = previous(widget);
        if (
          opening?.matches(
            ".cm-formatting-highlight:not(.cm-formatting-highlight-end)",
          )
        )
          next.set(opening, "comments-native-syntax");
      }
      const closing = surface.nextElementSibling;
      if (closing?.classList.contains("cm-formatting-highlight-end"))
        next.set(closing, "comments-native-syntax");
    }
    for (const [element, name] of this.owned)
      if (next.get(element) !== name) element.classList.remove(name);
    for (const [element, name] of next)
      if (!element.classList.contains(name)) element.classList.add(name);
    this.owned = next;
    // Ignore our own class mutations rather than queueing another pass.
    this.observer.takeRecords();
  }

  destroy() {
    this.destroyed = true;
    this.window.cancelAnimationFrame(this.frame);
    this.observer.disconnect();
    for (const [element, name] of this.owned) element.classList.remove(name);
    this.owned.clear();
  }
}
