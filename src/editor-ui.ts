import {
  EditorSelection,
  EditorState,
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
  type Tooltip,
  type TooltipView,
} from "@codemirror/view";
import { COLORS, newComment, type Color } from "./model";
import { annotationState, changeComments } from "./editor";
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
}
const chooseHighlight = StateEffect.define<string>();
export const composeSelection = StateEffect.define<boolean>();
export const selectionSession = StateField.define<SelectionSession | null>({
  create: (state) => sessionFor(state, null),
  update(previous, tr) {
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
      id = c.id;
      return [...records, c];
    });
  }
  if (id) view.dispatch({ effects: chooseHighlight.of(id) });
  return id ?? null;
}
type BindComposeKeys = (
  textarea: HTMLTextAreaElement,
  save: () => void,
  cancel: () => void,
) => () => void;
function selectionToolbar(
  view: EditorView,
  author: () => string,
  bindKeys?: BindComposeKeys,
): TooltipView {
  const document = view.dom.ownerDocument;
  const dom = document.adoptNode(createDiv());
  dom.className = "comments-selection-tooltip";
  const pill = dom.createDiv();
  pill.className = "comments-selection-pill";
  pill.setAttribute("role", "toolbar");
  pill.setAttribute("aria-label", "Annotate selection");
  const swatches = new Map<Color, HTMLButtonElement>();
  for (const color of COLORS) {
    const button = pill.createEl("button");
    button.type = "button";
    button.className = `comments-swatch comments-${color}`;
    button.title = `Highlight ${color}`;
    button.setAttribute("aria-label", button.title);
    button.setAttribute("aria-pressed", "false");
    button.createSpan().setAttribute("aria-hidden", "true");
    button.onmousedown = (event) => event.preventDefault();
    button.onclick = () => {
      try {
        if (origin && !origin.id && currentHighlight(view))
          throw new Error("This annotation changed. Reopen it before editing.");
        const id = colorSelection(view, color, author());
        if (origin && !origin.id && id) {
          const current = currentHighlight(view);
          origin.id = id;
          origin.author = current?.author;
          origin.status = current?.status;
        }
      } catch (e) {
        showError(e);
      }
    };
    swatches.set(color, button);
  }
  const separator = pill.createSpan();
  separator.className = "comments-pill-separator";
  separator.setAttribute("aria-hidden", "true");
  const noteButton = pill.createEl("button");
  noteButton.className = "comments-selection-note";
  noteButton.type = "button";
  const icon = noteButton.createSvg("svg");
  for (const [name, value] of Object.entries({
    "aria-hidden": "true",
    viewBox: "0 0 24 24",
    width: "16",
    height: "16",
    fill: "none",
    stroke: "currentColor",
    "stroke-width": "1.7",
    "stroke-linecap": "round",
    "stroke-linejoin": "round",
  }))
    icon.setAttribute(name, value);
  const path = icon.createSvg("path");
  path.setAttribute(
    "d",
    "M21 11.5a8.4 8.4 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.4 8.4 0 0 1-3.8-.9L3 21l1.9-5.7a8.4 8.4 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.4 8.4 0 0 1 3.8-.9H13a8.5 8.5 0 0 1 8 8v.5Z",
  );
  noteButton.onmousedown = (event) => event.preventDefault();
  noteButton.onclick = () => {
    view.dispatch({
      effects: composeSelection.of(
        !view.state.field(selectionSession)?.compose,
      ),
    });
    if (textarea?.isConnected) textarea.focus();
  };
  let panel: HTMLElement | undefined,
    textarea: HTMLTextAreaElement | undefined,
    error: HTMLElement | undefined,
    releaseKeys: (() => void) | undefined;
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
  function showError(reason: unknown) {
    if (!panel) openPanel();
    if (error) {
      error.textContent =
        reason instanceof Error ? reason.message : String(reason);
      error.hidden = false;
    }
  }
  function closePanel() {
    releaseKeys?.();
    releaseKeys = undefined;
    panel?.remove();
    panel = textarea = error = undefined;
    origin = undefined;
  }
  function openPanel() {
    if (panel) return;
    const session = view.state.field(selectionSession);
    if (!session) return;
    const p = view.state.field(annotationState),
      current = currentHighlight(view);
    origin = {
      source: p.source,
      from: session.from,
      to: session.to,
      body: current?.body ?? "",
      id: current?.id ?? null,
      author: current?.author,
      status: current?.status,
    };
    panel = dom.createDiv();
    panel.className = "comments-inline-compose";
    panel.setAttribute("role", "group");
    panel.setAttribute("aria-label", "Note for selected text");
    textarea = panel.createEl("textarea");
    textarea.placeholder = "Write a note…";
    textarea.setAttribute("aria-label", "Note for selected text");
    textarea.rows = 3;
    textarea.value = current?.body ?? "";
    error = panel.createEl("p");
    error.className = "comments-inline-error";
    error.hidden = true;
    error.setAttribute("role", "alert");
    const actions = panel.createDiv();
    actions.className = "comments-actions";
    const cancel = actions.createEl("button");
    cancel.type = "button";
    cancel.textContent = "Cancel";
    cancel.onclick = () => {
      view.dispatch({ effects: composeSelection.of(false) });
      view.focus();
    };
    const save = actions.createEl("button");
    save.type = "button";
    save.className = "mod-cta";
    save.textContent = "Save note";
    save.disabled = !textarea.value.trim();
    textarea.oninput = () => {
      save.disabled = !textarea!.value.trim();
    };
    const submit = () => {
      if (!textarea?.value.trim() || !origin) return;
      try {
        const p = view.state.field(annotationState),
          session = view.state.field(selectionSession);
        if (
          !session ||
          !p.source.eq(origin.source) ||
          session.from !== origin.from ||
          session.to !== origin.to
        )
          throw new Error(
            "The note changed. Select the target again before saving.",
          );
        const body = textarea.value.trim(),
          selected = currentHighlight(view);
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
          id = c.id;
          return [...records, c];
        });
        if (id)
          view.dispatch({
            effects: [chooseHighlight.of(id), composeSelection.of(false)],
          });
        view.focus();
      } catch (e) {
        showError(e);
      }
    };
    save.onclick = submit;
    releaseKeys = bindKeys?.(textarea, submit, () => cancel.click());
    textarea.onkeydown = (event) => {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        cancel.click();
      } else if ((event.ctrlKey || event.metaKey) && event.key === "Enter") {
        event.preventDefault();
        event.stopPropagation();
        submit();
      }
    };
    void Promise.resolve().then(() => {
      if (textarea?.isConnected) textarea.focus();
    });
    view.requestMeasure();
  }
  function update() {
    const current = currentHighlight(view),
      session = view.state.field(selectionSession);
    for (const [color, button] of swatches) {
      const pressed = String(current?.color === color);
      if (button.getAttribute("aria-pressed") !== pressed)
        button.setAttribute("aria-pressed", pressed);
    }
    const label = current?.body ? "Edit note" : "Add note";
    noteButton.setAttribute("aria-label", label);
    noteButton.title = label;
    if (session?.compose) openPanel();
    else if (panel) closePanel();
  }
  update();
  return {
    dom,
    offset: { x: 0, y: 8 },
    mount: () => {
      update();
      if (textarea) textarea.focus();
    },
    update: () => update(),
    positioned: () => dom.classList.add("is-positioned"),
    destroy: closePanel,
  };
}
export function editorUX(
  author: () => string,
  bindKeys?: BindComposeKeys,
): Extension {
  const create = (view: EditorView) => selectionToolbar(view, author, bindKeys);
  const createMath = (view: EditorView): TooltipView => ({
    ...selectionToolbar(view, author, bindKeys),
    getCoords: () => renderedMathCoordinates(view),
  });
  const tooltip = StateField.define<Tooltip | null>({
    create: (state) => makeTooltip(state),
    update(value, tr) {
      return tr.docChanged ||
        tr.selection ||
        tr.effects.some(
          (e) =>
            e.is(composeSelection) ||
            e.is(chooseHighlight) ||
            e.is(selectRenderedMath),
        )
        ? makeTooltip(tr.state)
        : value;
    },
    provide: (field) => showTooltip.from(field),
  });
  function makeTooltip(state: EditorState): Tooltip | null {
    const session = state.field(selectionSession);
    if (!session) return null;
    const math = state.field(renderedMathSelection);
    if (math)
      return { pos: math.from, end: math.to, above: true, create: createMath };
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
    storedDataVisible,
    footerPresentation,
    proseSelection,
    renderedMath,
    selectionSession,
    tooltip,
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
