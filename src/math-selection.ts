import { EditorSelection, StateEffect, StateField } from "@codemirror/state";
import {
  EditorView,
  ViewPlugin,
  type Rect,
  type ViewUpdate,
} from "@codemirror/view";
import { annotationState } from "./editor";
import type { Comment } from "./model";
import { mathHighlightBackground } from "./math-highlight";

export interface MathSelection {
  from: number;
  to: number;
}
export const selectRenderedMath = StateEffect.define<MathSelection | null>();
export const renderedMathSelection = StateField.define<MathSelection | null>({
  create: () => null,
  update(value, tr) {
    let selected = false;
    for (const effect of tr.effects)
      if (effect.is(selectRenderedMath)) {
        value = effect.value;
        selected = true;
      }
    if (!value) return null;
    const next = tr.state.field(annotationState);
    if (tr.state.readOnly || next.error || value.to > next.start) return null;
    if (tr.selection && !selected) return null;
    if (
      tr.docChanged &&
      !tr.startState.field(annotationState).source.eq(next.source)
    )
      return null;
    return value;
  },
});

export function mathSourceRange(
  view: EditorView,
  element: HTMLElement,
): MathSelection | null {
  const parent = element.parentNode;
  if (!parent || !view.contentDOM.contains(element)) return null;
  const index = Array.prototype.indexOf.call(parent.childNodes, element),
    from = view.posAtDOM(parent, index),
    limit = view.posAtDOM(parent, index + 1),
    source = view.state.doc.sliceString(from, limit).trimEnd(),
    delimiter = element.classList.contains("math-block") ? "$$" : "$";
  if (
    source.length <= delimiter.length * 2 ||
    !source.startsWith(delimiter) ||
    !source.endsWith(delimiter)
  )
    return null;
  return { from, to: from + source.length };
}
function enclosingMath(node: Node | null): HTMLElement | null {
  return (
    (node?.nodeType === 1
      ? (node as Element)
      : node?.parentElement
    )?.closest<HTMLElement>(".math") ?? null
  );
}
const mathView = ViewPlugin.fromClass(
  class {
    private frame = 0;
    private element: HTMLElement | null = null;
    private painted = new Map<HTMLElement, Comment>();
    private alive = true;
    private observer: MutationObserver;
    private document: Document;
    private window: Window;
    constructor(private view: EditorView) {
      this.document = view.dom.ownerDocument;
      this.window = this.document.defaultView!;
      this.document.addEventListener(
        "selectionchange",
        this.selectionChanged,
        true,
      );
      this.observer = new MutationObserver((changes) => {
        if (
          changes.some(
            (change) =>
              enclosingMath(change.target) ||
              Array.from(change.addedNodes).some(
                (node) =>
                  node.nodeType === 1 &&
                  ((node as Element).matches(".math") ||
                    (node as Element).querySelector(".math")),
              ),
          )
        )
          this.schedulePaint();
      });
      this.observer.observe(view.contentDOM, {
        childList: true,
        subtree: true,
      });
      this.schedulePaint();
    }
    private selectionChanged = () => {
      if (
        this.view.state.readOnly ||
        this.view.state.field(annotationState).error
      )
        return;
      const selection = this.document.getSelection(),
        anchor = enclosingMath(selection?.anchorNode ?? null);
      if (
        (!anchor || !this.view.contentDOM.contains(anchor)) &&
        !this.view.state.field(renderedMathSelection)
      )
        return;
      if (
        selection &&
        !selection.isCollapsed &&
        anchor &&
        anchor === enclosingMath(selection.focusNode) &&
        this.view.contentDOM.contains(anchor) &&
        this.document.activeElement === this.view.contentDOM
      )
        this.view.contentDOM.blur();
      if (this.frame) return;
      this.frame = this.window.requestAnimationFrame(() => {
        this.frame = 0;
        this.readSelection();
      });
    };
    private readSelection() {
      const document = this.document;
      if (document.activeElement?.closest(".comments-selection-tooltip"))
        return;
      const selection = document.getSelection(),
        anchor = enclosingMath(selection?.anchorNode ?? null),
        focus = enclosingMath(selection?.focusNode ?? null);
      const range =
        selection && !selection.isCollapsed && anchor && anchor === focus
          ? mathSourceRange(this.view, anchor)
          : null;
      this.element = range ? anchor : null;
      const previous = this.view.state.field(renderedMathSelection);
      if (previous?.from === range?.from && previous?.to === range?.to) return;
      this.view.dispatch({
        effects: selectRenderedMath.of(range),
        ...(range && !this.view.state.selection.main.empty
          ? {
              selection: EditorSelection.single(
                this.view.state.selection.main.head,
              ),
            }
          : {}),
      });
    }
    update(update: ViewUpdate) {
      if (update.docChanged || update.viewportChanged || update.geometryChanged)
        this.schedulePaint();
    }
    coordinates(): Rect {
      const range = this.view.state.field(renderedMathSelection);
      if (!this.element?.isConnected && range)
        this.element =
          Array.from(
            this.view.contentDOM.querySelectorAll<HTMLElement>(".math"),
          ).find(
            (element) =>
              mathSourceRange(this.view, element)?.from === range.from,
          ) ?? null;
      return (
        this.element?.querySelector("mjx-math") ??
        this.element ??
        this.view.dom
      ).getBoundingClientRect();
    }
    private schedulePaint() {
      this.view.requestMeasure({
        key: this,
        read: (view) => {
          if (!this.alive) return [];
          const records = view.state.field(annotationState).records;
          return Array.from(
            view.contentDOM.querySelectorAll<HTMLElement>(".math"),
          ).map((element) => {
            const range = mathSourceRange(view, element);
            const record =
              range &&
              records.find(
                (c) =>
                  c.kind !== "file" &&
                  c.status === "open" &&
                  c.target.state === "attached" &&
                  c.target.from < range.to &&
                  c.target.to > range.from,
              );
            return {
              element,
              record,
              background: record ? mathHighlightBackground(element) : "none",
            };
          });
        },
        write: (entries) => {
          if (!this.alive) return;
          const visible = new Set(entries.map((entry) => entry.element));
          for (const element of this.painted.keys())
            if (!visible.has(element)) this.clear(element);
          for (const { element, record, background } of entries) {
            const previous = this.painted.get(element);
            if (
              record &&
              element.style.getPropertyValue("--comments-math-bands") !==
                background
            )
              element.style.setProperty("--comments-math-bands", background);
            if (!record) {
              if (previous) this.clear(element);
              continue;
            }
            if (
              previous?.id === record.id &&
              previous.color === record.color &&
              previous.body === record.body
            )
              continue;
            if (previous) this.clear(element);
            element.classList.add(
              "comments-highlight",
              `comments-${record.color}`,
            );
            element.style.setProperty("--comments-math-bands", background);
            element.dataset.commentId = record.id;
            element.setAttribute("aria-label", record.body || "Open highlight");
            this.painted.set(element, record);
          }
        },
      });
    }
    private clear(element: HTMLElement) {
      const record = this.painted.get(element);
      if (!record) return;
      element.classList.remove(
        "comments-highlight",
        `comments-${record.color}`,
      );
      element.style.removeProperty("--comments-math-bands");
      element.removeAttribute("data-comment-id");
      element.removeAttribute("aria-label");
      this.painted.delete(element);
    }
    destroy() {
      this.alive = false;
      this.observer.disconnect();
      this.document.removeEventListener(
        "selectionchange",
        this.selectionChanged,
        true,
      );
      this.window.cancelAnimationFrame(this.frame);
      for (const element of this.painted.keys()) this.clear(element);
      this.element = null;
    }
  },
);
export const renderedMath = [renderedMathSelection, mathView];
export function renderedMathCoordinates(view: EditorView): Rect {
  return (
    view.plugin(mathView)?.coordinates() ?? view.dom.getBoundingClientRect()
  );
}
