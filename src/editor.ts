import { isolateHistory } from "@codemirror/commands";
import {
  EditorState,
  StateEffect,
  StateField,
  Text,
  type Transaction,
} from "@codemirror/state";
import {
  Decoration,
  EditorView,
  ViewPlugin,
  ViewUpdate,
  type DecorationSet,
} from "@codemirror/view";
import {
  locate,
  parse,
  reconcile,
  serialize,
  type Anchor,
  type Comment,
  type Parsed,
} from "./model";

/** Validated state belongs to this immutable editor document, never to a file path. */
export interface AnnotationSnapshot extends Parsed {
  needsPersistence: boolean;
  mapped: boolean;
  footer: string;
  source: Text;
  expected: Text;
}
function sameTarget(a: Anchor, b: Anchor): boolean {
  return (
    a.from === b.from &&
    a.to === b.to &&
    a.quote === b.quote &&
    a.originalQuote === b.originalQuote &&
    a.before === b.before &&
    a.after === b.after &&
    a.state === b.state
  );
}
function snapshot(
  source: Text,
  records: Comment[],
  footer: string,
  expected: Text,
  needsPersistence = false,
  mapped = false,
  knownSource?: string,
): AnnotationSnapshot {
  let document = knownSource;
  return {
    get document() {
      return (document ??= source.toString());
    },
    source,
    records,
    start: source.length,
    footer,
    expected,
    needsPersistence,
    mapped,
  };
}
function readSnapshot(doc: Text): AnnotationSnapshot {
  const parsed = parse(doc.toString());
  if (parsed.error)
    return { ...snapshot(doc, [], "", doc), error: parsed.error };
  const records = reconcile(parsed);
  return snapshot(
    doc.slice(0, parsed.start),
    records,
    doc.sliceString(parsed.start),
    doc,
    records.some((c, i) => !sameTarget(c.target, parsed.records[i].target)),
    false,
    parsed.document,
  );
}
/** Only a changed region can create a new marker in previously validated source.
 * Expand through arbitrary whitespace because the boundary grammar permits it after <!--.
 * No fixed lookaround limit can safely handle that whitespace run.
 */
function introducesMarker(tr: Transaction, end: number): boolean {
  let found = false;
  tr.changes.iterChangedRanges((_a, _b, from, to) => {
    if (found || from > end) return;
    let left = Math.max(0, from - 32),
      right = Math.min(end, to + 32);
    while (left > 0) {
      const begin = Math.max(0, left - 2048),
        chunk = tr.newDoc.sliceString(begin, left + 1);
      let i = chunk.length - 1;
      while (i >= 0 && /\s/.test(chunk[i])) i--;
      if (i >= 0) {
        left = begin + i;
        break;
      }
      left = begin;
    }
    while (right < end) {
      const limit = Math.min(end, right + 2048),
        chunk = tr.newDoc.sliceString(right - 1, limit);
      let i = 0;
      while (i < chunk.length && /\s/.test(chunk[i])) i++;
      if (i < chunk.length) {
        right = right - 1 + i;
        break;
      }
      right = limit;
    }
    left = Math.max(0, left - 4);
    right = Math.min(end, right + 24);
    found = /<!--\s*obsidian-comments:/.test(
      tr.newDoc.sliceString(left, right),
    );
  });
  return found;
}
const snapshotEffect = StateEffect.define<AnnotationSnapshot>();
const revealHighlights = StateEffect.define<readonly string[]>();
export const annotationState = StateField.define<AnnotationSnapshot>({
  create: (state) => readSnapshot(state.doc),
  update(value, tr) {
    // The filter supplies validated mapped state. No JSON parsing or quote matching on typing.
    for (const effect of tr.effects)
      if (effect.is(snapshotEffect)) {
        const next = effect.value;
        // Other editor extensions can also filter transactions. Never accept stale prepared data.
        if (tr.newDoc.eq(next.expected)) return next;
        return readSnapshot(tr.newDoc);
      }
    return tr.docChanged ? readSnapshot(tr.newDoc) : value;
  },
});
const filter = EditorState.transactionFilter.of((tr) => {
  if (!tr.docChanged) return tr;
  const before = tr.startState.field(annotationState);
  if (before.error) return tr;
  let touchesFooter = false;
  tr.changes.iterChangedRanges((from, to) => {
    if (from > before.start || to > before.start) touchesFooter = true;
  });
  if (touchesFooter) {
    // Lifecycle/source-footer changes and whole-document sync are revalidated once by the field.
    return tr.isUserEvent("undo") || tr.isUserEvent("redo")
      ? tr
      : [tr, { annotations: isolateHistory.of("full") }];
  }
  const end = tr.changes.mapPos(before.start, 1);
  if (introducesMarker(tr, end))
    return [tr, { annotations: isolateHistory.of("full") }];
  const source = tr.newDoc.slice(0, end);
  if (!before.records.length)
    return [
      tr,
      {
        effects: snapshotEffect.of(
          snapshot(source, [], "", tr.newDoc, false, true),
        ),
      },
    ];
  let dirty = before.needsPersistence,
    reusable = true;
  const records = before.records.map((c) => {
    if (c.kind === "file" || c.target.state === "detached") return c;
    const from = tr.changes.mapPos(c.target.from, 1),
      to = tr.changes.mapPos(c.target.to, -1);
    if (to <= from) {
      dirty = true;
      reusable = false;
      return locate(source.toString(), {
        ...c,
        target: { ...c.target, from: 0, to: 0 },
      });
    }
    const quote =
      to - from === c.target.to - c.target.from &&
      !tr.changes.touchesRange(c.target.from, c.target.to)
        ? c.target.quote
        : source.sliceString(from, to);
    const target: Anchor = {
      from,
      to,
      quote,
      originalQuote: c.target.originalQuote,
      before: source.sliceString(Math.max(0, from - 64), from),
      after: source.sliceString(to, Math.min(source.length, to + 64)),
      state: "attached",
    };
    if (sameTarget(target, c.target)) return c;
    dirty = true;
    return { ...c, target };
  });
  const footer = dirty ? serialize("", records) : before.footer;
  const insert = dirty ? Text.of(footer.split("\n")) : null;
  const expected = insert
    ? tr.newDoc.replace(end, tr.newDoc.length, insert)
    : tr.newDoc;
  const next = snapshot(source, records, footer, expected, false, reusable);
  const effects = snapshotEffect.of(next);
  if (!dirty) return [tr, { effects }];
  // Keep the readable on-disk format and a single undoable transaction; only replace the footer.
  return [
    tr,
    {
      changes: { from: end, to: tr.newDoc.length, insert: insert! },
      effects,
      sequential: true,
    },
  ];
});
export const anchorFilter = [annotationState, filter];

export function changeComments(
  view: EditorView,
  fn: (records: Comment[], document: string) => Comment[],
): void {
  const before = view.state.field(annotationState);
  if (before.error) throw new Error(before.error);
  const records = fn(before.records, before.document),
    footer = serialize("", records),
    insert = Text.of(footer.split("\n"));
  const expected = view.state.doc.replace(
    before.start,
    view.state.doc.length,
    insert,
  );
  const next = snapshot(before.source, records, footer, expected);
  const previous = new Map(before.records.map((c) => [c.id, c.color]));
  const reveal = records
    .filter(
      (c) =>
        c.kind !== "file" &&
        c.status === "open" &&
        c.target.state === "attached" &&
        c.target.to > c.target.from &&
        previous.get(c.id) !== c.color,
    )
    .map((c) => c.id);
  view.dispatch({
    changes: { from: before.start, to: view.state.doc.length, insert },
    effects: [snapshotEffect.of(next), revealHighlights.of(reveal)],
    annotations: isolateHistory.of("full"),
  });
}

export function editorExtension(
  reveal: (ids: string[]) => void,
  observe?: (view: EditorView, snapshot: AnnotationSnapshot) => void,
  preview?: (element: HTMLElement) => void,
) {
  return [
    anchorFilter,
    ViewPlugin.fromClass(
      class {
        decorations: DecorationSet;
        private pending = new Set<string>();
        private animations = new Map<HTMLElement, Animation>();
        private destroyed = false;
        constructor(view: EditorView) {
          this.decorations = this.build(view);
          observe?.(view, view.state.field(annotationState));
        }
        update(u: ViewUpdate) {
          if (u.docChanged) {
            const next = u.state.field(annotationState);
            this.decorations = next.mapped
              ? this.decorations.map(u.changes)
              : this.build(u.view);
          }
          for (const tr of u.transactions) {
            if (tr.docChanged) this.pending.clear();
            for (const effect of tr.effects)
              if (effect.is(revealHighlights))
                for (const id of effect.value) this.pending.add(id);
          }
          if (this.pending.size) this.reveal(u.view);
          // DecorationSet is document-wide; scrolling needs no parsing, matching, or rebuilding.
          observe?.(u.view, u.state.field(annotationState));
        }
        private motionAllowed(view: EditorView) {
          const document = view.dom.ownerDocument;
          return (
            !document.body.classList.contains("is-reduced-motion") &&
            !document.defaultView!.matchMedia(
              "(prefers-reduced-motion: reduce), (forced-colors: active)",
            ).matches
          );
        }
        private reveal(view: EditorView) {
          if (!this.motionAllowed(view)) {
            this.pending.clear();
            return;
          }
          view.requestMeasure({
            key: this,
            read: () => {
              const marks = this.destroyed
                ? []
                : Array.from(
                    view.contentDOM.querySelectorAll<HTMLElement>(
                      ".comments-highlight",
                    ),
                  ).filter((mark) => this.pending.has(mark.dataset.commentId!));
              this.pending.clear();
              return marks;
            },
            write: (marks) => {
              if (this.destroyed || !this.motionAllowed(view)) return;
              for (const mark of marks) {
                if (!mark.isConnected) continue;
                this.animations.get(mark)?.cancel();
                const backgroundImage =
                  "linear-gradient(to right, var(--comment-tint) 0%, var(--comment-tint) 40%, transparent 60%)";
                const animation = mark.animate(
                  [
                    {
                      backgroundImage,
                      backgroundSize: "250% 100%",
                      backgroundPosition: "100% 0%",
                      borderBottomColor: "transparent",
                    },
                    {
                      backgroundImage,
                      backgroundSize: "250% 100%",
                      backgroundPosition: "0% 0%",
                      borderBottomColor: "var(--comment-ink)",
                    },
                  ],
                  { duration: 460, easing: "cubic-bezier(0.4, 0, 0.2, 1)" },
                );
                this.animations.set(mark, animation);
                animation.onfinish = animation.oncancel = () => {
                  if (this.animations.get(mark) === animation)
                    this.animations.delete(mark);
                };
              }
            },
          });
        }
        destroy() {
          this.destroyed = true;
          this.pending.clear();
          for (const animation of this.animations.values()) animation.cancel();
          this.animations.clear();
        }
        build(view: EditorView) {
          const p = view.state.field(annotationState);
          if (p.error) return Decoration.none;
          return Decoration.set(
            p.records
              .filter(
                (c) =>
                  c.kind !== "file" &&
                  c.status === "open" &&
                  c.target.state === "attached" &&
                  c.target.to > c.target.from,
              )
              .map((c) =>
                Decoration.mark({
                  class: `comments-highlight comments-${c.color}`,
                  attributes: {
                    "data-comment-id": c.id,
                    "aria-label": c.body || "Open highlight",
                  },
                }).range(c.target.from, c.target.to),
              ),
            true,
          );
        }
      },
      {
        decorations: (v) => v.decorations,
        eventHandlers: {
          pointerover(event, view) {
            const mark = (event.target as Element).closest<HTMLElement>(
              ".comments-highlight",
            );
            if (mark && view.contentDOM.contains(mark)) preview?.(mark);
            return false;
          },
          click(event, view) {
            if (
              !view.state.selection.main.empty ||
              view.dom.ownerDocument.getSelection()?.isCollapsed === false
            )
              return false;
            const pos = view.posAtCoords({
              x: event.clientX,
              y: event.clientY,
            });
            if (pos === null) return false;
            const p = view.state.field(annotationState);
            if (p.error) return false;
            const ids = p.records
              .filter(
                (c) =>
                  c.status === "open" &&
                  c.kind !== "file" &&
                  c.target.state === "attached" &&
                  c.target.from <= pos &&
                  pos < c.target.to,
              )
              .map((c) => c.id);
            if (ids.length) reveal(ids);
            return false;
          },
        },
      },
    ),
  ];
}
