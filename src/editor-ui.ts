import {
  EditorSelection,
  EditorState,
  Facet,
  StateEffect,
  StateField,
  type Extension,
} from "@codemirror/state";
import {
  Decoration,
  EditorView,
  ViewPlugin,
  showTooltip,
  type DecorationSet,
  type Rect,
  type Tooltip,
  type TooltipView,
} from "@codemirror/view";
import { mobileSelectionDock } from "./mobile-dock";
import { COLORS, newComment, type Color } from "./model";
import {
  annotationControls,
  type BindComposeKeys,
} from "./annotation-controls";
import { annotationState, changeComments } from "./editor";
import { canUseNative } from "./native-highlight";
const nativeHighlightsEnabled = Facet.define<boolean, boolean>({
  combine: (values) => values[0] ?? true,
});
import {
  renderedMath,
  renderedMathSelection,
  selectRenderedMath,
  renderedMathCoordinates,
} from "./math-selection";

export const showStoredData = StateEffect.define<boolean>();
export const storedDataVisible = StateField.define<boolean>({
  create: () => false,
  update(value, tr) {
    for (const effect of tr.effects)
      if (effect.is(showStoredData)) value = effect.value;
    return value;
  },
});
export function toggleStoredData(view: EditorView): void {
  const visible = !view.state.field(storedDataVisible),
    p = view.state.field(annotationState);
  view.dispatch({
    effects: showStoredData.of(visible),
    ...(!p.error && p.footer
      ? {
          selection: EditorSelection.single(
            visible
              ? Math.min(p.start + 2, view.state.doc.length)
              : Math.min(view.state.selection.main.head, p.start),
          ),
          scrollIntoView: true,
        }
      : {}),
  });
}
export const footerPresentation = StateField.define<DecorationSet>({
  create: footerDecorations,
  update(value, tr) {
    return tr.docChanged || tr.effects.some((e) => e.is(showStoredData))
      ? footerDecorations(tr.state)
      : value;
  },
  provide: (field) => EditorView.decorations.from(field),
});
function footerDecorations(state: EditorState): DecorationSet {
  const p = state.field(annotationState);
  if (p.error || !p.footer) return Decoration.none;
  if (state.field(storedDataVisible)) return Decoration.none;
  // No placeholder, counter, or button in the document. The command palette is the
  // explicit inspection route; the separator retains an editable prose boundary.
  return Decoration.set([
    Decoration.replace({ block: true }).range(p.start + 1, state.doc.length),
  ]);
}
/** Keep navigation and forward-delete out of folded storage. Only user delete events that
 * cross the hidden separator are rejected; explicit raw edits and sync transactions are untouched. */
export const proseSelection = EditorState.transactionFilter.of((tr) => {
  if (
    tr.startState.field(storedDataVisible) ||
    tr.effects.some((e) => e.is(showStoredData) && e.value)
  )
    return tr;
  const p = tr.startState.field(annotationState);
  if (p.error || !p.footer) return tr;
  if (tr.docChanged) {
    if (tr.isUserEvent("delete")) {
      let crosses = false;
      tr.changes.iterChanges((from, to, _a, _b, insert) => {
        if (from >= p.start && to > p.start && !insert.length) crosses = true;
      });
      if (crosses) return [];
    }
    return tr;
  }
  if (tr.newSelection.ranges.every((r) => r.to <= p.start)) return tr;
  const ranges = tr.newSelection.ranges.map((r) =>
    EditorSelection.range(
      Math.min(r.anchor, p.start),
      Math.min(r.head, p.start),
    ),
  );
  return [
    tr,
    { selection: EditorSelection.create(ranges, tr.newSelection.mainIndex) },
  ];
});
export interface SelectionSession {
  from: number;
  to: number;
  highlightId: string | null;
  compose: boolean;
  reopened?: boolean;
}
const chooseHighlight = StateEffect.define<string>();
export const activateHighlight = StateEffect.define<string | null>();
export const composeSelection = StateEffect.define<boolean>();
export const selectionSession = StateField.define<SelectionSession | null>({
  create: (state) => sessionFor(state, null),
  update(previous, tr) {
    const activation = tr.effects.find((e) => e.is(activateHighlight));
    if (activation && activation.value === null) return null;
    const caretInHighlight =
      previous &&
      tr.newSelection.main.empty &&
      tr.newSelection.main.head >= previous.from &&
      tr.newSelection.main.head <= previous.to;
    if (
      activation ||
      (previous?.reopened &&
        (!tr.selection || caretInHighlight) &&
        !tr.isUserEvent("input") &&
        !tr.isUserEvent("delete") &&
        !tr.effects.some((e) => e.is(selectRenderedMath)))
    ) {
      const id = activation?.value ?? previous?.highlightId;
      const record = tr.state
        .field(annotationState)
        .records.find((c) => c.id === id);
      if (
        tr.state.readOnly ||
        tr.state.field(annotationState).error ||
        !record ||
        record.status !== "open" ||
        record.kind === "file" ||
        record.target.state !== "attached" ||
        record.target.from === record.target.to
      )
        return null;
      let compose = activation ? false : (previous?.compose ?? false);
      for (const effect of tr.effects)
        if (effect.is(composeSelection)) compose = effect.value;
      return {
        from: record.target.from,
        to: record.target.to,
        highlightId: record.id,
        compose,
        reopened: true,
      };
    }
    const selection =
      tr.state.field(renderedMathSelection, false) ?? tr.newSelection.main;
    if (selection.from === selection.to) return null;
    const same =
      previous &&
      tr.changes.mapPos(previous.from, 1) === selection.from &&
      tr.changes.mapPos(previous.to, -1) === selection.to;
    let next = sessionFor(tr.state, same ? previous : null);
    if (next)
      for (const effect of tr.effects) {
        if (
          effect.is(chooseHighlight) &&
          tr.state
            .field(annotationState)
            .records.some(
              (c) =>
                c.id === effect.value &&
                c.target.state === "attached" &&
                c.target.from === next!.from &&
                c.target.to === next!.to,
            )
        )
          next = { ...next, highlightId: effect.value };
        if (effect.is(composeSelection))
          next = { ...next, compose: effect.value };
      }
    return next;
  },
});
export function openHighlight(view: EditorView, id: string): void {
  view.dispatch({
    effects: [selectRenderedMath.of(null), activateHighlight.of(id)],
  });
}
function dismissToolbar(view: EditorView): void {
  view.dispatch({
    selection: EditorSelection.single(view.state.selection.main.head),
    effects: [selectRenderedMath.of(null), activateHighlight.of(null)],
  });
  view.focus();
}
function sessionFor(
  state: EditorState,
  previous: SelectionSession | null,
): SelectionSession | null {
  const selection =
    state.field(renderedMathSelection, false) ?? state.selection.main;
  if (selection.from === selection.to || state.readOnly) return null;
  const p = state.field(annotationState);
  if (p.error || selection.to > p.start) return null;
  let id = previous?.highlightId ?? null;
  const matches = p.records.filter(
    (c) =>
      c.status === "open" &&
      c.kind !== "file" &&
      c.target.state === "attached" &&
      c.target.from === selection.from &&
      c.target.to === selection.to,
  );
  if (!matches.some((c) => c.id === id))
    id = matches.length === 1 ? matches[0].id : null;
  return {
    from: selection.from,
    to: selection.to,
    highlightId: id,
    compose: previous?.compose ?? false,
  };
}
function currentHighlight(view: EditorView) {
  const session = view.state.field(selectionSession);
  return session?.highlightId
    ? view.state
        .field(annotationState)
        .records.find((c) => c.id === session.highlightId)
    : undefined;
}
export function colorSelection(
  view: EditorView,
  color: Color,
  author: string,
): string | null {
  const session = view.state.field(selectionSession);
  if (!session) return null;
  const current = currentHighlight(view);
  let id = current?.id;
  if (!current || current.color !== color) {
    changeComments(view, (records, document) => {
      if (current)
        return records.map((c) =>
          c.id === current.id
            ? { ...c, color, updated: new Date().toISOString() }
            : c,
        );
      const c = newComment(
        document,
        session.from,
        session.to,
        "selection",
        "",
        author,
        color,
      );
      if (
        view.state.facet(nativeHighlightsEnabled) &&
        canUseNative(document, session.from, session.to, records)
      )
        c.native = true;
      id = c.id;
      return [...records, c];
    });
  }
  if (id) view.dispatch({ effects: chooseHighlight.of(id) });
  return id ?? null;
}
function selectionToolbar(
  view: EditorView,
  author: () => string,
  bindKeys?: BindComposeKeys,
  visibleColors?: () => readonly Color[],
): TooltipView {
  const document = view.dom.ownerDocument;
  let origin:
    | {
        source: typeof view.state.doc;
        from: number;
        to: number;
        body: string;
        id: string | null;
        author: string | undefined;
        status: string | undefined;
      }
    | undefined;
  const controls = annotationControls(
    document,
    {
      current: () => currentHighlight(view),
      composing: () => !!view.state.field(selectionSession)?.compose,
      beginNote: () => {
        const session = view.state.field(selectionSession);
        if (!session) throw new Error("Select a highlight before editing.");
        const current = currentHighlight(view);
        origin = {
          source: view.state.field(annotationState).source,
          from: session.from,
          to: session.to,
          body: current?.body ?? "",
          id: current?.id ?? null,
          author: current?.author,
          status: current?.status,
        };
      },
      setComposing: (open) =>
        view.dispatch({ effects: composeSelection.of(open) }),
      color: (color) => {
        if (origin && !origin.id && currentHighlight(view))
          throw new Error("This annotation changed. Reopen it before editing.");
        const before = view.state.field(annotationState).source;
        const id = colorSelection(view, color, author());
        // Our syntax insertion/recoloring is not an external edit to the draft.
        // Only advance a snapshot that was current before this operation.
        if (origin && origin.source.eq(before)) {
          const session = view.state.field(selectionSession);
          origin.source = view.state.field(annotationState).source;
          if (session) {
            origin.from = session.from;
            origin.to = session.to;
          }
        }
        if (origin && !origin.id && id) {
          const current = currentHighlight(view);
          origin.id = id;
          origin.author = current?.author;
          origin.status = current?.status;
        }
      },
      save: (body) => {
        const p = view.state.field(annotationState),
          session = view.state.field(selectionSession);
        if (
          !origin ||
          !session ||
          !p.source.eq(origin.source) ||
          session.from !== origin.from ||
          session.to !== origin.to
        )
          throw new Error(
            "The note changed. Select the target again before saving.",
          );
        const selected = currentHighlight(view);
        let id = selected?.id;
        if (origin.id ? selected?.id !== origin.id : !!selected)
          throw new Error("The annotation changed. Select the target again.");
        changeComments(view, (records, document) => {
          if (selected) {
            if (
              selected.body !== origin!.body ||
              selected.author !== origin!.author ||
              selected.status !== origin!.status ||
              selected.target.from !== origin!.from ||
              selected.target.to !== origin!.to
            )
              throw new Error(
                "This annotation changed. Reopen it before editing.",
              );
            return records.map((c) =>
              c.id === selected.id
                ? { ...c, body, updated: new Date().toISOString() }
                : c,
            );
          }
          const c = newComment(
            document,
            origin!.from,
            origin!.to,
            "selection",
            body,
            author(),
            "yellow",
          );
          if (
            view.state.facet(nativeHighlightsEnabled) &&
            canUseNative(document, origin!.from, origin!.to, records)
          )
            c.native = true;
          id = c.id;
          return [...records, c];
        });
        if (id)
          view.dispatch({
            effects: [chooseHighlight.of(id), composeSelection.of(false)],
          });
        view.focus();
      },
      close: () => dismissToolbar(view),
      focus: () => view.focus(),
      measure: () => view.requestMeasure(),
    },
    bindKeys,
    visibleColors,
  );
  const { dom } = controls;
  const dismissOutside = (event: Event) => {
    if (
      event.target instanceof document.defaultView!.Node &&
      !view.dom.contains(event.target) &&
      !dom.contains(event.target)
    )
      dismissWithoutFocus();
  };
  const dismissWithoutFocus = () => {
    if (view.state.field(selectionSession))
      view.dispatch({ effects: activateHighlight.of(null) });
  };
  let anchor: Rect | null = null;
  return {
    dom,
    offset: { x: 0, y: 8 },
    getCoords: (pos) => {
      // Capture the anchor in CodeMirror's read phase. Its layout APIs cannot
      // be called from positioned(), which runs in the write phase.
      const session = view.state.field(selectionSession);
      const math = session?.reopened
        ? Array.from(
            view.contentDOM.querySelectorAll<HTMLElement>(
              ".math.comments-highlight",
            ),
          ).find((element) => element.dataset.commentId === session.highlightId)
        : undefined;
      anchor =
        math?.getBoundingClientRect() ??
        (view.state.field(renderedMathSelection)
          ? renderedMathCoordinates(view)
          : view.coordsAtPos(pos));
      return anchor ?? { top: -1e9, bottom: -1e9, left: 0, right: 0 };
    },
    mount: () => {
      document.addEventListener("pointerdown", dismissOutside, true);
      document.addEventListener("focusin", dismissOutside, true);
      document.defaultView!.addEventListener("blur", dismissWithoutFocus);
      controls.mount();
    },
    update: () => controls.update(),
    // CodeMirror's default bounds are the window, but Obsidian clips absolute
    // tooltips at the editor pane. Constrain only our popup, not host tooltips.
    resize: false,
    positioned: (space) => {
      const pane = view.scrollDOM.getBoundingClientRect();
      const left = Math.max(space.left, pane.left) + 8;
      const right = Math.min(space.right, pane.right) - 8;
      dom.style.setProperty(
        "--comments-popup-max-width",
        `${Math.max(0, right - left) / view.scaleX}px`,
      );
      const top = Math.max(space.top, pane.top) + 8;
      let bottom = Math.min(space.bottom, pane.bottom) - 8;
      const status = document
        .querySelector(".status-bar")
        ?.getBoundingClientRect();
      if (
        status?.height &&
        status.right > pane.left &&
        status.left < pane.right &&
        status.top > top
      )
        bottom = Math.min(bottom, status.top - 8);
      const available = Math.max(0, bottom - top);
      dom.style.setProperty(
        "--comments-popup-max-height",
        `${available / view.scaleY}px`,
      );
      dom.classList.toggle(
        "is-height-constrained",
        dom.scrollHeight > available / view.scaleY,
      );
      const rect = dom.getBoundingClientRect();
      const nextLeft = Math.max(left, Math.min(rect.left, right - rect.width));
      if (nextLeft !== rect.left)
        dom.style.left = `${parseFloat(dom.style.left) + (nextLeft - rect.left) / view.scaleX}px`;
      const height = Math.min(rect.height, available);
      let nextTop = Math.max(top, Math.min(rect.top, bottom - height));
      if (rect.top < top || rect.bottom > bottom) {
        if (anchor) {
          if (rect.top < top && anchor.bottom + 8 + height <= bottom) {
            nextTop = anchor.bottom + 8;
            dom.classList.replace("cm-tooltip-above", "cm-tooltip-below");
          } else if (rect.bottom > bottom && anchor.top - 8 - height >= top) {
            nextTop = anchor.top - 8 - height;
            dom.classList.replace("cm-tooltip-below", "cm-tooltip-above");
          }
        }
      }
      if (nextTop !== rect.top)
        dom.style.top = `${parseFloat(dom.style.top) + (nextTop - rect.top) / view.scaleY}px`;
      dom.classList.add("is-positioned");
    },
    destroy: () => {
      document.removeEventListener("pointerdown", dismissOutside, true);
      document.removeEventListener("focusin", dismissOutside, true);
      document.defaultView!.removeEventListener("blur", dismissWithoutFocus);
      controls.destroy();
    },
  };
}
export function editorUX(
  author: () => string,
  bindKeys?: BindComposeKeys,
  mobile = false,
  nativeHighlights = true,
  visibleColors: () => readonly Color[] = () => COLORS,
): Extension {
  const create = (view: EditorView) =>
    selectionToolbar(view, author, bindKeys, visibleColors);
  const tooltip = StateField.define<Tooltip | null>({
    create: (state) => makeTooltip(state),
    update(value, tr) {
      return tr.docChanged ||
        tr.selection ||
        tr.effects.some(
          (e) =>
            e.is(composeSelection) ||
            e.is(chooseHighlight) ||
            e.is(activateHighlight) ||
            e.is(selectRenderedMath),
        )
        ? makeTooltip(tr.state)
        : value;
    },
    provide: (field) => showTooltip.from(field),
  });
  function makeTooltip(state: EditorState): Tooltip | null {
    const session = state.field(selectionSession);
    if (!session || mobile) return null;
    if (session.reopened)
      return {
        pos: Math.max(
          session.from,
          Math.min(state.selection.main.head, session.to),
        ),
        end: session.to,
        above: true,
        create,
      };
    const math = state.field(renderedMathSelection);
    if (math) return { pos: math.from, end: math.to, above: true, create };
    const selection = state.selection.main;
    // Follow the fixed end of the gesture, not the moving start of a backwards
    // selection. Open on the opposite side so the pill stays out of the drag path.
    return {
      pos: selection.anchor,
      end: session.to,
      above: selection.head > selection.anchor,
      create,
    };
  }
  return [
    nativeHighlightsEnabled.of(nativeHighlights),
    storedDataVisible,
    footerPresentation,
    proseSelection,
    renderedMath,
    selectionSession,
    tooltip,
    EditorView.domEventHandlers({
      pointerdown(event, view) {
        if (
          view.state.field(selectionSession) &&
          !(event.target as Element).closest(
            ".comments-highlight, .comments-selection-tooltip",
          )
        )
          view.dispatch({ effects: activateHighlight.of(null) });
        return false;
      },
      keydown(event, view) {
        if (event.key === "Escape" && view.state.field(selectionSession)) {
          dismissToolbar(view);
          return true;
        }
        return false;
      },
    }),
    ...(mobile
      ? [
          mobileSelectionDock(
            (view) => !!view.state.field(selectionSession),
            create,
            (view) => {
              const session = view.state.field(selectionSession);
              if (!session) return [];
              if (view.state.field(renderedMathSelection)) {
                const math = renderedMathCoordinates(view);
                if (math) return [math];
              }
              const start = view.coordsAtPos(session.from, 1);
              const end = view.coordsAtPos(session.to, -1);
              if (start && end)
                return [
                  {
                    left: Math.min(start.left, end.left),
                    right: Math.max(start.right, end.right),
                    top: Math.min(start.top, end.top),
                    bottom: Math.max(start.bottom, end.bottom),
                  },
                ];
              return [start, end].filter((rect): rect is Rect => !!rect);
            },
          ),
        ]
      : []),
    EditorView.atomicRanges.of((view) =>
      view.state.field(storedDataVisible)
        ? Decoration.none
        : view.state.field(footerPresentation),
    ),
    ViewPlugin.fromClass(
      class {
        alive = true;
        constructor(view: EditorView) {
          const p = view.state.field(annotationState);
          if (!p.error && p.footer && view.state.selection.main.to > p.start)
            void Promise.resolve().then(() => {
              if (this.alive && !view.state.field(storedDataVisible)) {
                const p = view.state.field(annotationState);
                if (!p.error)
                  view.dispatch({ selection: EditorSelection.single(p.start) });
              }
            });
        }
        destroy() {
          this.alive = false;
        }
      },
    ),
  ];
}
