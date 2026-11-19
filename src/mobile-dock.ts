import { MobileDockPlacement } from "./mobile-dock-placement";
import { styleMobileControls } from "./annotation-controls";
import {
  ViewPlugin,
  type EditorView,
  type Rect,
  type TooltipView,
  type ViewUpdate,
} from "@codemirror/view";

/** A mobile-only host for the existing selection controls, outside the editor's
 * transformed/clipped DOM. It stays at an edge instead of following the handles. */
export function mobileSelectionDock(
  visible: (view: EditorView) => boolean,
  create: (view: EditorView) => TooltipView,
  targets: (view: EditorView) => readonly Rect[] = () => [],
) {
  return ViewPlugin.fromClass(
    class {
      private toolbar: TooltipView | null = null;
      private placement = new MobileDockPlacement();
      private frame = 0;
      private destroyed = false;
      private dismissed = false;
      private checkFocus = false;
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
        this.document.addEventListener("focusin", this.interaction, true);
        this.document.addEventListener("pointerdown", this.interaction, true);
        this.document.addEventListener("focusout", this.focusLeft, true);
        this.window.addEventListener("blur", this.dismiss);
        this.document.addEventListener("pointerup", this.schedule);
        this.sync();
      }
      update(update: ViewUpdate) {
        this.sync(update);
      }
      private sync(update?: ViewUpdate) {
        const leaf = this.view.dom.closest(".workspace-leaf");
        if (
          this.dismissed ||
          !visible(this.view) ||
          (leaf && !leaf.classList.contains("mod-active"))
        ) {
          this.close();
          return;
        }
        if (!this.toolbar) {
          this.toolbar = create(this.view);
          this.toolbar.dom.classList.add("comments-mobile-dock");
          styleMobileControls(this.toolbar.dom);
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
      private owns(target: Node | null) {
        return (
          !!target &&
          (this.view.dom.contains(target) ||
            !!this.toolbar?.dom.contains(target))
        );
      }
      private interaction = (event: Event) => {
        if (!(event.target instanceof this.document.defaultView!.Node)) return;
        if (!this.owns(event.target)) {
          this.dismiss();
        } else if (this.dismissed) {
          this.dismissed = false;
          this.sync();
        }
      };
      private focusLeft = () => {
        // Focus can move from the editor into the composer in the same event.
        this.checkFocus = true;
        this.schedule();
      };
      private dismiss = () => {
        this.dismissed = true;
        this.close();
      };
      private hasNativeMathSelection() {
        // Rendered math deliberately blurs CodeMirror to keep its native range.
        const selection = this.document.getSelection();
        const math = selection?.anchorNode?.parentElement?.closest(".math");
        return (
          selection &&
          !selection.isCollapsed &&
          math &&
          this.view.dom.contains(math) &&
          math.contains(selection.focusNode)
        );
      }
      private schedule = () => {
        if (this.destroyed || this.frame) return;
        this.frame = this.window.requestAnimationFrame(() => {
          this.frame = 0;
          if (this.checkFocus) {
            this.checkFocus = false;
            if (
              !this.owns(this.document.activeElement) &&
              !this.hasNativeMathSelection()
            ) {
              this.dismiss();
              return;
            }
          }
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
        const header = leaf
          .querySelector(".view-header")
          ?.getBoundingClientRect();
        const ceiling = Math.max(
          top,
          editor.top,
          header?.height ? header.bottom : top,
        );
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
          `${Math.max(0, floor - ceiling)}px`,
        );
        dom.style.setProperty(
          "--comments-dock-safe-bottom",
          floor < bottom - 1 ? "0px" : "env(safe-area-inset-bottom)",
        );
        dom.style.setProperty(
          "--comments-dock-safe-top",
          ceiling > top ? "0px" : "env(safe-area-inset-top)",
        );
        this.placement.update(dom, ceiling, floor, targets(this.view));
        dom.classList.add("is-positioned");
      }
      private close() {
        if (!this.toolbar) return;
        this.resize.unobserve(this.toolbar.dom);
        this.toolbar.destroy?.();
        this.toolbar.dom.remove();
        this.toolbar = null;
        this.placement.reset();
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
        this.document.removeEventListener("focusin", this.interaction, true);
        this.document.removeEventListener(
          "pointerdown",
          this.interaction,
          true,
        );
        this.document.removeEventListener("focusout", this.focusLeft, true);
        this.window.removeEventListener("blur", this.dismiss);
        this.document.removeEventListener("pointerup", this.schedule);
        this.close();
      }
    },
  );
}
