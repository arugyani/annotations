import { annotationControls, styleMobileControls } from "./annotation-controls";
import { COLORS, type Comment } from "./model";

/** A Reading-view host for the same controls used by the editor. */
export class ReadingAnnotationControls {
  private controls: ReturnType<typeof annotationControls>;
  private document: Document;
  private window: Window;
  private pane: HTMLElement;
  private observer: MutationObserver;
  private resize: ResizeObserver;
  private frame = 0;
  private disposed = false;
  private focusPending = false;
  private compose = false;
  private original: Comment | undefined;
  readonly id: string;
  constructor(
    private anchor: HTMLElement,
    private current: Comment,
    private change: (fn: (records: Comment[]) => Comment[]) => Promise<boolean>,
    private mobile: boolean,
    private onClose: () => void,
  ) {
    this.id = current.id;
    this.document = anchor.ownerDocument;
    this.window = this.document.defaultView!;
    this.pane =
      anchor.closest<HTMLElement>(".markdown-reading-view") ??
      anchor.closest<HTMLElement>(".workspace-leaf") ??
      anchor.parentElement!;
    this.controls = annotationControls(this.document, {
      current: () => this.current,
      composing: () => this.compose,
      beginNote: () => {
        this.original = this.current;
      },
      setComposing: (value) => {
        this.compose = value;
        this.schedule();
      },
      color: (color) =>
        this.mutate((record) => ({
          ...record,
          color,
          updated: new Date().toISOString(),
        })),
      save: async (body) => {
        const original = this.original;
        await this.mutate((record) => {
          if (
            !original ||
            record.body !== original.body ||
            record.author !== original.author ||
            record.target.quote !== original.target.quote
          )
            throw new Error(
              "This annotation changed. Reopen it before editing.",
            );
          return { ...record, body, updated: new Date().toISOString() };
        });
        if (this.disposed) return;
        this.compose = false;
        this.controls.update();
        this.focus();
      },
      close: () => this.close(true),
      focus: () => this.focus(),
      measure: () => this.schedule(),
    });
    const dom = this.controls.dom;
    dom.classList.add("comments-reading-controls");
    if (mobile) {
      dom.classList.add("comments-mobile-dock");
      styleMobileControls(dom);
    }
    dom.addEventListener("pointerdown", (event) => {
      if ((event.target as Element).closest("button")) event.preventDefault();
    });
    this.document.body.appendChild(dom);
    this.resize = new this.document.defaultView!.ResizeObserver(this.schedule);
    this.resize.observe(dom);
    this.resize.observe(this.pane);
    this.observer = new this.document.defaultView!.MutationObserver(
      this.schedule,
    );
    this.observer.observe(this.pane, { childList: true, subtree: true });
    this.document.addEventListener("pointerdown", this.outside, true);
    this.document.addEventListener("focusin", this.outside, true);
    this.document.addEventListener("keydown", this.keydown);
    this.document.addEventListener("scroll", this.schedule, true);
    this.window.addEventListener("resize", this.schedule);
    this.window.addEventListener("blur", this.blurred);
    this.window.visualViewport?.addEventListener("resize", this.schedule);
    this.window.visualViewport?.addEventListener("scroll", this.schedule);
    this.controls.mount();
    this.schedule();
  }
  refresh(record: Comment | undefined) {
    if (this.disposed) return;
    if (
      !record ||
      record.status !== "open" ||
      record.target.state !== "attached"
    ) {
      this.close();
      return;
    }
    this.current = record;
    this.findAnchor();
    this.controls.update();
    this.schedule();
  }
  focusControls() {
    this.focusPending = true;
    this.schedule();
  }
  private async mutate(fn: (record: Comment) => Comment) {
    let updated: Comment | undefined;
    const saved = await this.change((records) => {
      const record = records.find((c) => c.id === this.id);
      if (
        !record ||
        record.status !== "open" ||
        record.target.state !== "attached"
      )
        throw new Error(
          "This highlight is no longer available. Reopen the note.",
        );
      updated = fn(record);
      return records.map((c) => (c.id === record.id ? updated! : c));
    });
    if (!saved || !updated)
      throw new Error(
        "The annotation could not be saved. Your note has been kept here.",
      );
    this.refresh(updated);
  }
  private findAnchor() {
    const next = this.anchor.isConnected
      ? this.anchor
      : Array.from(
          this.pane.querySelectorAll<HTMLElement>(
            ".comments-highlight[data-comment-id]",
          ),
        ).find((el) => el.dataset.commentId === this.id);
    if (!next) return undefined;
    this.anchor = next;
    // Metadata-only writes do not always rerender an unchanged Markdown block.
    for (const color of COLORS)
      next.classList.toggle(`comments-${color}`, color === this.current.color);
    next.setAttribute("aria-label", this.current.body || "Open highlight");
    return next;
  }
  private focus() {
    this.findAnchor()?.focus({ preventScroll: true });
  }
  private outside = (event: Event) => {
    if (!(event.target instanceof this.document.defaultView!.Node)) return;
    if (
      !this.controls.dom.contains(event.target) &&
      !this.findAnchor()?.contains(event.target)
    )
      this.close();
  };
  private keydown = (event: KeyboardEvent) => {
    if (event.key === "Escape" && !event.defaultPrevented) {
      event.preventDefault();
      this.close(true);
    }
  };
  private blurred = () => this.close();
  private schedule = () => {
    if (this.disposed || this.frame) return;
    this.frame = this.window.requestAnimationFrame(() => {
      this.frame = 0;
      this.position();
    });
  };
  private position() {
    if (!this.pane.isConnected) {
      this.close();
      return;
    }
    const anchor = this.findAnchor();
    // A vault write can briefly replace the rendered section. Keep the draft
    // while the replacement mark is being mounted by the postprocessor.
    if (!anchor) return;
    const viewport = this.window.visualViewport;
    const left = viewport?.offsetLeft ?? 0,
      top = viewport?.offsetTop ?? 0;
    const right = left + (viewport?.width ?? this.window.innerWidth);
    let bottom = top + (viewport?.height ?? this.window.innerHeight);
    const pane = this.pane.getBoundingClientRect();
    const dom = this.controls.dom;
    const start = Math.max(left, pane.left),
      end = Math.min(right, pane.right);
    for (const bar of this.document.querySelectorAll<HTMLElement>(
      this.mobile ? ".mobile-toolbar, .mobile-navbar" : ".status-bar",
    )) {
      const r = bar.getBoundingClientRect();
      if (
        r.width &&
        r.height &&
        r.right > start &&
        r.left < end &&
        r.top > top &&
        this.window.getComputedStyle(bar).visibility !== "hidden"
      )
        bottom = Math.min(bottom, r.top);
    }
    if (this.mobile) {
      dom.style.setProperty("--comments-dock-left", `${start}px`);
      dom.style.setProperty(
        "--comments-dock-width",
        `${Math.max(0, end - start)}px`,
      );
      dom.style.setProperty(
        "--comments-dock-bottom",
        `${Math.min(bottom, pane.bottom)}px`,
      );
      dom.style.setProperty(
        "--comments-dock-height",
        `${Math.max(0, bottom - top)}px`,
      );
      dom.style.setProperty(
        "--comments-dock-safe-bottom",
        bottom < top + (viewport?.height ?? this.window.innerHeight)
          ? "0px"
          : "env(safe-area-inset-bottom)",
      );
    } else {
      const ceiling = Math.max(top, pane.top) + 8,
        floor = Math.min(bottom, pane.bottom) - 8;
      dom.style.setProperty(
        "--comments-popup-max-height",
        `${Math.max(0, floor - ceiling)}px`,
      );
      dom.classList.toggle(
        "is-height-constrained",
        dom.scrollHeight > floor - ceiling,
      );
      const rect = dom.getBoundingClientRect(),
        target = anchor.getBoundingClientRect();
      const y =
        target.top - rect.height - 8 >= ceiling
          ? target.top - rect.height - 8
          : Math.min(target.bottom + 8, floor - rect.height);
      dom.style.top = `${Math.max(ceiling, y)}px`;
      dom.style.left = `${Math.max(start + 8, Math.min(target.left, end - rect.width - 8))}px`;
    }
    dom.classList.add("is-positioned");
    if (this.focusPending) {
      this.focusPending = false;
      dom
        .querySelector<HTMLButtonElement>(
          '.comments-swatch[aria-pressed="true"]',
        )
        ?.focus({ preventScroll: true });
    }
  }
  close(returnFocus = false) {
    if (this.disposed) return;
    this.disposed = true;
    this.window.cancelAnimationFrame(this.frame);
    this.resize.disconnect();
    this.observer.disconnect();
    this.document.removeEventListener("pointerdown", this.outside, true);
    this.document.removeEventListener("focusin", this.outside, true);
    this.document.removeEventListener("keydown", this.keydown);
    this.document.removeEventListener("scroll", this.schedule, true);
    this.window.removeEventListener("resize", this.schedule);
    this.window.removeEventListener("blur", this.blurred);
    this.window.visualViewport?.removeEventListener("resize", this.schedule);
    this.window.visualViewport?.removeEventListener("scroll", this.schedule);
    this.controls.destroy();
    this.controls.dom.remove();
    if (returnFocus) this.focus();
    this.onClose();
  }
}
