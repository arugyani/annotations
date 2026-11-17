import {
  ViewPlugin,
  type EditorView,
  type TooltipView,
  type ViewUpdate,
} from "@codemirror/view";

/** A mobile-only host for the existing selection controls, outside the editor's
 * transformed/clipped DOM. It never follows the selection rectangle. */
export function mobileSelectionDock(
  visible: (view: EditorView) => boolean,
  create: (view: EditorView) => TooltipView,
) {
  return ViewPlugin.fromClass(
    class {
      private toolbar: TooltipView | null = null;
      private frame = 0;
      private destroyed = false;
      private document: Document;
      private window: Window;
      private resize: ResizeObserver;
      constructor(private view: EditorView) {
        this.document = view.dom.ownerDocument;
        this.window = this.document.defaultView!;
        this.resize = new this.document.defaultView!.ResizeObserver(
          this.schedule,
        );
        this.resize.observe(view.dom);
        this.window.visualViewport?.addEventListener("resize", this.schedule);
        this.window.visualViewport?.addEventListener("scroll", this.schedule);
        this.window.addEventListener("resize", this.schedule);
        this.document.addEventListener("scroll", this.schedule, true);
        this.document.addEventListener("focusin", this.schedule);
        this.document.addEventListener("pointerup", this.schedule);
        this.sync();
      }
      update(update: ViewUpdate) {
        this.sync(update);
      }
      private sync(update?: ViewUpdate) {
        const leaf = this.view.dom.closest(".workspace-leaf");
        if (
          !visible(this.view) ||
          (leaf && !leaf.classList.contains("mod-active"))
        ) {
          this.close();
          return;
        }
        if (!this.toolbar) {
          this.toolbar = create(this.view);
          this.toolbar.dom.classList.add("comments-mobile-dock");
          this.toolbar.dom.addEventListener("pointerdown", (event) => {
            if ((event.target as Element).closest("button"))
              event.preventDefault();
          });
          this.document.body.appendChild(this.toolbar.dom);
          this.toolbar.mount?.(this.view);
          this.resize.observe(this.toolbar.dom);
        } else if (update) {
          this.toolbar.update?.(update);
        }
        this.schedule();
      }
      private schedule = () => {
        if (this.destroyed || this.frame) return;
        this.frame = this.window.requestAnimationFrame(() => {
          this.frame = 0;
          const leaf = this.view.dom.closest(".workspace-leaf");
          if (leaf && !leaf.classList.contains("mod-active")) {
            this.close();
            return;
          }
          this.position();
        });
      };
      private position() {
        if (!this.toolbar) return;
        const viewport = this.window.visualViewport;
        const left = viewport?.offsetLeft ?? 0;
        const top = viewport?.offsetTop ?? 0;
        const right = left + (viewport?.width ?? this.window.innerWidth);
        const bottom = top + (viewport?.height ?? this.window.innerHeight);
        const leaf = this.view.dom.closest(".workspace-leaf") ?? this.view.dom;
        const editor = leaf.getBoundingClientRect();
        const start = Math.max(left, editor.left);
        const end = Math.min(right, editor.right);
        let floor = Math.min(bottom, editor.bottom);
        // Obsidian's mobile formatting/navigation bars are DOM elements; the
        // native iOS edit menu is not. Reserve space for visible host bars.
        for (const bar of this.document.querySelectorAll<HTMLElement>(
          ".mobile-toolbar, .mobile-navbar",
        )) {
          this.resize.observe(bar);
          const rect = bar.getBoundingClientRect();
          if (
            rect.width &&
            rect.height &&
            rect.right > start &&
            rect.left < end &&
            rect.bottom > top &&
            rect.top >= top &&
            rect.top < floor &&
            this.window.getComputedStyle(bar).visibility !== "hidden"
          ) {
            floor = rect.top;
          }
        }
        const dom = this.toolbar.dom;
        dom.style.setProperty("--comments-dock-left", `${start}px`);
        dom.style.setProperty(
          "--comments-dock-width",
          `${Math.max(0, end - start)}px`,
        );
        dom.style.setProperty("--comments-dock-bottom", `${floor}px`);
        dom.style.setProperty(
          "--comments-dock-height",
          `${Math.max(0, floor - top)}px`,
        );
        dom.style.setProperty(
          "--comments-dock-safe-bottom",
          floor < bottom - 1 ? "0px" : "env(safe-area-inset-bottom)",
        );
        dom.classList.add("is-positioned");
      }
      private close() {
        if (!this.toolbar) return;
        this.resize.unobserve(this.toolbar.dom);
        this.toolbar.destroy?.();
        this.toolbar.dom.remove();
        this.toolbar = null;
      }
      destroy() {
        this.destroyed = true;
        this.window.cancelAnimationFrame(this.frame);
        this.resize.disconnect();
        this.window.visualViewport?.removeEventListener(
          "resize",
          this.schedule,
        );
        this.window.visualViewport?.removeEventListener(
          "scroll",
          this.schedule,
        );
        this.window.removeEventListener("resize", this.schedule);
        this.document.removeEventListener("scroll", this.schedule, true);
        this.document.removeEventListener("focusin", this.schedule);
        this.document.removeEventListener("pointerup", this.schedule);
        this.close();
      }
    },
  );
}
