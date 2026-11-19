import { SidebarSelection } from "./sidebar-selection";
import {
  Plugin,
  Platform,
  requireApiVersion,
  ItemView,
  Menu,
  Scope,
  setIcon,
  setTooltip,
  editorInfoField,
  WorkspaceLeaf,
  MarkdownView,
  MarkdownRenderChild,
  Modal,
  Notice,
  TFile,
  type Editor,
  type MarkdownPostProcessorContext,
} from "obsidian";
import {
  COLORS,
  anchor,
  mutate,
  newComment,
  parse,
  reconcile,
  unitRange,
  type Comment,
  type Color,
  type Kind,
} from "./model";
import {
  annotationState,
  changeComments,
  editorExtension,
  type AnnotationSnapshot,
} from "./editor";
import type { EditorView } from "@codemirror/view";
import type { Parsed } from "./model";
import { readSettings, type AnnotationSettings } from "./settings";
import { PaletteStyles } from "./palette-styles";
import { CommentsSettings } from "./settings-tab";
import { ReadingAnnotationControls } from "./reading-controls";
import { canUseNative } from "./native-highlight";
import { sidebarPassage } from "./sidebar-passage";
import {
  editorUX,
  toggleStoredData,
  composeSelection,
  openHighlight,
} from "./editor-ui";
interface NoteSnapshot extends Parsed {
  readonly lineStarts: number[];
}
function withLines(parsed: Parsed): NoteSnapshot {
  let lines: number[] | undefined;
  return {
    get document() {
      return parsed.document;
    },
    records: parsed.records,
    start: parsed.start,
    error: parsed.error,
    get lineStarts() {
      if (!lines) {
        lines = [0];
        const text = parsed.document;
        for (let i = text.indexOf("\n"); i >= 0; i = text.indexOf("\n", i + 1))
          lines.push(i + 1);
      }
      return lines;
    },
  };
}
const VIEW = "comments-sidebar";
function setAnnotationTooltip(element: HTMLElement) {
  setTooltip(element, element.getAttribute("aria-label") || "Open highlight", {
    classes: ["comments-note-preview"],
    placement: "bottom",
    gap: 8,
    delay: 350,
  });
}
export default class CommentsPlugin extends Plugin {
  readonly author = "Me";
  paletteSettings = readSettings(undefined);
  private paletteStyles = new PaletteStyles();
  private settingsQueue: Promise<void> = Promise.resolve();
  selected: string[] = [];
  currentFile: TFile | null = null;
  reattaching: string | null = null;
  reattachFile: TFile | null = null;
  private readingLayers = new Set<MarkdownRenderChild>();
  private unloaded = false;
  private inlineScopes = new Set<Scope>();
  private editorViews = new WeakMap<Editor, EditorView>();
  private liveNotes = new WeakMap<AnnotationSnapshot, NoteSnapshot>();
  private readNotes = new Map<TFile, Promise<NoteSnapshot>>();
  private readingControls:
    { file: TFile; popup: ReadingAnnotationControls } | undefined;
  private readingActivation = 0;
  async onload() {
    this.register(() => {
      this.readingActivation++;
      this.readingControls?.popup.close();
    });
    this.paletteSettings = readSettings(await this.loadData());
    this.app.workspace.onLayoutReady(() => {
      if (!this.unloaded) {
        this.currentFile = this.app.workspace.getActiveFile();
        this.refresh();
      }
    });
    this.register(() => {
      for (const scope of this.inlineScopes) this.app.keymap.popScope(scope);
      this.inlineScopes.clear();
    });
    this.registerEvent(
      this.app.workspace.on("file-open", (file) => {
        if (file?.extension === "md") this.currentFile = file;
        this.refresh();
      }),
    );
    this.register(() => {
      this.unloaded = true;
      for (const layer of this.readingLayers) layer.unload();
      this.readingLayers.clear();
      this.readNotes.clear();
    });
    this.register(() => this.paletteStyles.destroy());
    this.addSettingTab(new CommentsSettings(this));
    this.registerView(VIEW, (l) => new CommentsView(l, this));
    this.addRibbonIcon(
      "message-square",
      "Open Annotations",
      () => void this.show(),
    );
    this.addCommand({
      id: "open",
      name: "Open sidebar",
      callback: () => void this.show(),
    });
    for (const kind of ["selection", "block", "section", "file"] as Kind[])
      this.addCommand({
        id: `add-${kind}`,
        name: `Comment on ${kind === "selection" ? "selection" : `current ${kind}`}`,
        editorCallback: (editor, view) => this.add(editor, view.file, kind),
      });
    this.addCommand({
      id: "reattach",
      name: "Reattach selected comment to selection",
      editorCallback: (e, v) => void this.reattach(e, v.file),
    });
    this.registerEvent(
      this.app.workspace.on("editor-menu", (menu, e, info) => {
        menu.addItem((i) =>
          i
            .setTitle("Add comment to selection")
            .setIcon("message-square")
            .onClick(() => this.add(e, info.file, "selection")),
        );
        if (this.reattaching)
          menu.addItem((i) =>
            i
              .setTitle("Reattach comment here")
              .onClick(() => void this.reattach(e, info.file)),
          );
      }),
    );
    this.registerEditorExtension([
      editorExtension(
        (ids, view) => openHighlight(view, ids[0]),
        (view, _snapshot) => {
          this.applyPalette(view.dom.ownerDocument);
          const info = view.state.field(editorInfoField, false);
          if (info?.editor && this.editorViews.get(info.editor) !== view)
            this.editorViews.set(info.editor, view);
        },
        setAnnotationTooltip,
      ),
      editorUX(
        () => this.author,
        (textarea, save, cancel) => {
          const scope = new Scope(this.app.scope);
          scope.register(["Mod"], "Enter", (event) => {
            if (textarea.ownerDocument.activeElement === textarea) {
              event.preventDefault();
              save();
              return false;
            }
          });
          scope.register([], "Escape", (event) => {
            if (textarea.ownerDocument.activeElement === textarea) {
              event.preventDefault();
              cancel();
              return false;
            }
          });
          const activate = () => {
            if (!this.inlineScopes.has(scope)) {
              this.inlineScopes.add(scope);
              this.app.keymap.pushScope(scope);
            }
          };
          const deactivate = () => {
            if (this.inlineScopes.delete(scope))
              this.app.keymap.popScope(scope);
          };
          textarea.addEventListener("focus", activate);
          textarea.addEventListener("blur", deactivate);
          if (textarea.ownerDocument.activeElement === textarea) activate();
          return () => {
            textarea.removeEventListener("focus", activate);
            textarea.removeEventListener("blur", deactivate);
            deactivate();
          };
        },
        Platform.isMobileApp,
        requireApiVersion("1.14.0"),
        () => this.paletteSettings.visibleColors,
      ),
    ]);
    this.addCommand({
      id: "toggle-data",
      name: "Show/hide stored comment data",
      editorCallback: (e) => {
        const view = this.editorViews.get(e);
        if (view) toggleStoredData(view);
      },
    });
    this.addCommand({
      id: "note-selection",
      name: "Add note to selection",
      editorCallback: (e) => {
        const view = this.editorViews.get(e);
        if (!e.somethingSelected()) {
          new Notice("Select text first.");
          return;
        }
        if (view) {
          view.focus();
          view.dispatch({ effects: composeSelection.of(true) });
        }
      },
    });
    this.addCommand({
      id: "reveal-at-cursor",
      name: "Show comments at cursor",
      editorCallback: (e) => {
        const p = parse(e.getValue()),
          pos = e.posToOffset(e.getCursor());
        if (p.error) return;
        const ids = reconcile(p)
          .filter(
            (c) =>
              c.kind === "file" ||
              (c.target.state === "attached" &&
                c.target.from <= pos &&
                pos <= c.target.to),
          )
          .map((c) => c.id);
        if (ids.length) void this.reveal(ids);
        else new Notice("No comment at the cursor.");
      },
    });
    this.registerMarkdownPostProcessor((el, ctx) => this.reading(el, ctx));
    this.registerEvent(
      this.app.workspace.on("active-leaf-change", () => {
        this.readingActivation++;
        this.readingControls?.popup.close();
        this.refresh();
      }),
    );
    this.registerEvent(
      this.app.workspace.on("editor-change", (_editor, info) => {
        if (info.file === this.activeFile()) this.refresh();
      }),
    );
    this.registerEvent(
      this.app.vault.on("modify", (file) => {
        if (file instanceof TFile) this.readNotes.delete(file);
        // A footer-only change leaves prose blocks cached, including old marks.
        // Refresh matching previews so their annotation IDs and colors stay current.
        for (const leaf of this.app.workspace.getLeavesOfType("markdown")) {
          const view = leaf.view;
          if (view instanceof MarkdownView && view.file === file)
            view.previewMode.rerender(true);
        }
        const active = this.readingControls;
        if (active?.file === file)
          void this.note(active.file)
            .then((snapshot) => {
              if (this.readingControls === active)
                active.popup.refresh(
                  snapshot.error
                    ? undefined
                    : snapshot.records.find((c) => c.id === active.popup.id),
                );
            })
            .catch(() => {
              if (this.readingControls === active) active.popup.close();
            });
        if (file === this.activeFile()) this.refresh();
      }),
    );
    this.registerEvent(
      this.app.vault.on("rename", (file) => {
        if (file instanceof TFile) this.readNotes.delete(file);
        if (file === this.activeFile()) this.refresh();
      }),
    );
    this.registerEvent(
      this.app.vault.on("delete", (file) => {
        if (file instanceof TFile) this.readNotes.delete(file);
        if (this.readingControls?.file === file)
          this.readingControls.popup.close();
        if (file === this.currentFile) {
          this.currentFile = null;
          this.refresh();
        }
      }),
    );
  }
  async onExternalSettingsChange() {
    this.paletteSettings = readSettings(await this.loadData());
    this.paletteStyles.update(this.paletteSettings);
  }
  applyPalette(document: Document) {
    this.paletteStyles.apply(document, this.paletteSettings);
  }
  setSettings(settings: AnnotationSettings) {
    this.paletteSettings = readSettings(settings);
    this.paletteStyles.update(this.paletteSettings);
    const snapshot = this.paletteSettings;
    this.settingsQueue = this.settingsQueue
      .catch(() => {})
      .then(() => this.saveData(snapshot));
    void this.settingsQueue.catch(
      () => new Notice("Unable to save annotation settings."),
    );
  }
  refresh() {
    for (const leaf of this.app.workspace.getLeavesOfType(VIEW))
      if (leaf.view instanceof CommentsView) leaf.view.schedule();
  }
  async reveal(ids: string[]) {
    this.selected = ids;
    await this.show();
    for (const leaf of this.app.workspace.getLeavesOfType(VIEW)) {
      if (!(leaf.view instanceof CommentsView)) continue;
      const v = leaf.view;
      v.filter = "all";
      v.color = "all";
      v.query = "";
      void v.render();
    }
  }
  async show() {
    const existing = this.app.workspace.getLeavesOfType(VIEW);
    const narrow = this.app.workspace.containerEl.win.innerWidth < 650;
    let leaf = existing.find(
      (l) => (l.getRoot() === this.app.workspace.rootSplit) === narrow,
    );
    if (!leaf)
      leaf = narrow
        ? this.app.workspace.getLeaf("tab")
        : this.app.workspace.getRightLeaf(false)!;
    if (!leaf) return;
    await leaf.setViewState({ type: VIEW, active: true });
    for (const old of existing) if (old !== leaf) old.detach();
    if (narrow) {
      this.app.workspace.rightSplit.collapse();
      this.app.workspace.leftSplit.collapse();
    }
    await this.app.workspace.revealLeaf(leaf);
    this.refresh();
  }
  activeFile() {
    const file = this.app.workspace.getActiveFile();
    return file?.extension === "md" ? file : this.currentFile;
  }
  editorFor(file: TFile) {
    const recent = this.app.workspace.getMostRecentLeaf()?.view;
    if (
      recent instanceof MarkdownView &&
      recent.file === file &&
      recent.getMode() === "source"
    )
      return recent.editor;
    for (const leaf of this.app.workspace.getLeavesOfType("markdown")) {
      const view = leaf.view;
      if (
        view instanceof MarkdownView &&
        view.file === file &&
        view.getMode() === "source"
      )
        return view.editor;
    }
    return undefined;
  }
  async note(file: TFile): Promise<NoteSnapshot> {
    const editor = this.editorFor(file),
      view = editor && this.editorViews.get(editor);
    if (view) {
      const state = view.state.field(annotationState, false);
      if (state) {
        let cached = this.liveNotes.get(state);
        if (!cached) {
          cached = withLines(state);
          this.liveNotes.set(state, cached);
        }
        return cached;
      }
    }
    if (editor) {
      const p = parse(editor.getValue());
      return withLines(p.error ? p : { ...p, records: reconcile(p) });
    }
    const cached = this.readNotes.get(file);
    if (cached) {
      this.readNotes.delete(file);
      this.readNotes.set(file, cached);
      return cached;
    }
    const pending = this.app.vault.read(file).then((raw) => {
      const p = parse(raw);
      return withLines(p.error ? p : { ...p, records: reconcile(p) });
    });
    this.readNotes.set(file, pending);
    // Bound retained documents; concurrent Reading-view sections share this same promise.
    if (this.readNotes.size > 4)
      this.readNotes.delete(this.readNotes.keys().next().value!);
    try {
      return await pending;
    } catch (error) {
      if (this.readNotes.get(file) === pending) this.readNotes.delete(file);
      throw error;
    }
  }
  /** Mutate latest editor buffer synchronously or latest disk content with Vault.process. */
  async change(
    file: TFile,
    fn: (records: Comment[], document: string) => Comment[],
  ) {
    try {
      const e = this.editorFor(file);
      if (e) {
        const view = this.editorViews.get(e);
        if (view) changeComments(view, fn);
        else {
          const old = e.getValue(),
            next = mutate(old, fn);
          if (next !== old) {
            let from = 0,
              oldEnd = old.length,
              newEnd = next.length;
            while (from < oldEnd && from < newEnd && old[from] === next[from])
              from++;
            while (
              oldEnd > from &&
              newEnd > from &&
              old[oldEnd - 1] === next[newEnd - 1]
            ) {
              oldEnd--;
              newEnd--;
            }
            e.replaceRange(
              next.slice(from, newEnd),
              e.offsetToPos(from),
              e.offsetToPos(oldEnd),
            );
          }
        }
      } else await this.app.vault.process(file, (raw) => mutate(raw, fn));
      this.readNotes.delete(file);
      this.refresh();
      return true;
    } catch (err) {
      new Notice(String(err instanceof Error ? err.message : err));
      return false;
    }
  }
  add(editor: Editor, file: TFile | null, kind: Kind) {
    if (!file) return;
    const p =
      this.editorViews.get(editor)?.state.field(annotationState, false) ??
      parse(editor.getValue());
    if (p.error) {
      new Notice(p.error);
      return;
    }
    let from = editor.posToOffset(editor.getCursor("from")),
      to = editor.posToOffset(editor.getCursor("to"));
    if (kind !== "selection") [from, to] = unitRange(p.document, from, kind);
    if (
      (kind === "selection" && from === to) ||
      from > p.start ||
      to > p.start
    ) {
      new Notice("Select document text to comment on.");
      return;
    }
    const snapshot = p.document;
    new CommentModal(this, "Add comment", undefined, (body, color, author) => {
      // A modal may remain open while sync changes the file; never reuse stale offsets.
      void this.change(file, (records, document) => {
        if (document !== snapshot)
          throw new Error(
            "The note changed. Select the target again before adding a comment.",
          );
        const comment = newComment(
          document,
          from,
          to,
          kind,
          body,
          author,
          color,
        );
        if (
          kind === "selection" &&
          requireApiVersion("1.14.0") &&
          canUseNative(document, from, to, records)
        )
          comment.native = true;
        return [...records, comment];
      });
      void this.show();
    }).open();
  }
  async reattach(editor: Editor, file: TFile | null) {
    if (!file || !this.reattaching) {
      new Notice("Choose Reattach on a comment first.");
      return;
    }
    if (file !== this.reattachFile) {
      new Notice("Select the target in the same note as the comment.");
      return;
    }
    const id = this.reattaching,
      from = editor.posToOffset(editor.getCursor("from")),
      to = editor.posToOffset(editor.getCursor("to")),
      snapshot =
        this.editorViews.get(editor)?.state.field(annotationState, false) ??
        parse(editor.getValue());
    if (from === to || snapshot.error || to > snapshot.start) {
      new Notice("Select the new target in the document.");
      return;
    }
    const saved = await this.change(file, (records, document) => {
      if (document !== snapshot.document || !records.some((c) => c.id === id))
        throw new Error(
          "Target note changed or comment belongs to another note.",
        );
      return records.map((c) =>
        c.id === id
          ? {
              ...c,
              kind: "selection",
              target: anchor(document, from, to, c.target.originalQuote),
              updated: new Date().toISOString(),
            }
          : c,
      );
    });
    if (saved) {
      this.reattaching = null;
      this.reattachFile = null;
    }
  }
  async navigate(file: TFile, c: Comment) {
    if (c.target.state === "detached") {
      new Notice("This target needs reattachment.");
      return;
    }
    const recent = this.app.workspace.getMostRecentLeaf();
    const leaf =
      (recent?.view instanceof MarkdownView && recent.view.file === file
        ? recent
        : undefined) ??
      this.app.workspace
        .getLeavesOfType("markdown")
        .find((l) => l.view instanceof MarkdownView && l.view.file === file) ??
      this.app.workspace.getLeaf(false);
    await leaf.openFile(file, { state: { mode: "source" } });
    const view = leaf.view;
    if (!(view instanceof MarkdownView)) return;
    const p = await this.note(file);
    const fresh = p.error ? undefined : p.records.find((x) => x.id === c.id);
    if (!fresh || fresh.target.state === "detached") return;
    const from = view.editor.offsetToPos(fresh.target.from),
      to = view.editor.offsetToPos(fresh.target.to);
    view.editor.setSelection(from, to);
    view.editor.scrollIntoView({ from, to }, true);
    view.editor.focus();
  }
  async reading(el: HTMLElement, ctx: MarkdownPostProcessorContext) {
    this.applyPalette(el.ownerDocument);
    const file = this.app.vault.getAbstractFileByPath(ctx.sourcePath);
    if (!(file instanceof TFile)) return;
    const layer = new MarkdownRenderChild(el),
      cleanups: (() => void)[] = [];
    let disposed = false;
    layer.register(() => {
      disposed = true;
      for (const cleanup of cleanups) cleanup();
      this.readingLayers.delete(layer);
    });
    this.readingLayers.add(layer);
    ctx.addChild(layer);
    let p: NoteSnapshot;
    try {
      p = await this.note(file);
    } catch (error) {
      if (!disposed && !this.unloaded)
        console.error("Annotations: unable to read note.", error);
      return;
    }
    if (disposed || this.unloaded || p.error) return;
    const document = el.ownerDocument;
    const records = p.records.filter(
      (c) =>
        c.status === "open" &&
        c.kind !== "file" &&
        c.target.state === "attached",
    );
    if (!records.length) return;
    const info = ctx.getSectionInfo(el);
    if (!info) return;
    const sectionFrom = p.lineStarts[info.lineStart] ?? p.document.length;
    const sectionTo = p.lineStarts[info.lineEnd + 1] ?? p.document.length;
    const relevant = records.filter(
      (c) => c.target.from < sectionTo && c.target.to > sectionFrom,
    );
    if (!relevant.length) return;
    // Exact single-node quotations can open their controls in place.
    for (const c of relevant) {
      if (c.native) {
        // Match source order as well as quotation: repeated words must not open
        // another annotation. Refuse ambiguous transformed Markdown.
        const spans = [
          ...p.document
            .slice(sectionFrom, sectionTo)
            .matchAll(/==(?:[🟡🔵🟢🟣🔴🟠])?([^=\n]+)==/gu),
        ].filter((match) => match[1] === c.target.quote);
        const index = spans.findIndex(
          (match) =>
            sectionFrom +
              match.index +
              match[0].length -
              2 -
              match[1].length ===
            c.target.from,
        );
        // Include marks already attached in this section when finding their ordinal.
        const all = Array.from(el.querySelectorAll<HTMLElement>("mark")).filter(
          (mark) => mark.textContent === c.target.quote,
        );
        const mark = all[index];
        if (
          index < 0 ||
          spans.length !== all.length ||
          !mark ||
          mark.dataset.commentId
        )
          continue;
        const attributes = Array.from(mark.attributes).map((a) => [
          a.name,
          a.value,
        ]);
        const click = mark.onclick,
          keydown = mark.onkeydown;
        mark.classList.add(
          "comments-highlight",
          "comments-native",
          `comments-${c.color}`,
        );
        this.bindReadingMark(mark, file, c);
        cleanups.push(() => {
          for (const attribute of Array.from(mark.attributes))
            mark.removeAttribute(attribute.name);
          for (const [name, value] of attributes)
            mark.setAttribute(name, value);
          mark.onclick = click;
          mark.onkeydown = keydown;
        });
        continue;
      }
      const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
      let node: Node | null;
      const hits: { node: Text; index: number }[] = [];
      while ((node = walker.nextNode())) {
        if (node.parentElement?.closest("button,mark,script,style")) continue;
        const text = node.textContent || "";
        let i = text.indexOf(c.target.quote);
        while (i >= 0 && c.target.quote) {
          hits.push({ node: node as Text, index: i });
          i = text.indexOf(c.target.quote, i + 1);
        }
      }
      if (hits.length === 1) {
        const hit = hits[0],
          range = document.createRange();
        range.setStart(hit.node, hit.index);
        range.setEnd(hit.node, hit.index + c.target.quote.length);
        const mark = document.adoptNode(createEl("mark"));
        mark.className = `comments-highlight comments-${c.color}`;
        this.bindReadingMark(mark, file, c);
        range.surroundContents(mark);
        cleanups.push(() => mark.replaceWith(...Array.from(mark.childNodes)));
      }
    }
  }
  private bindReadingMark(mark: HTMLElement, file: TFile, c: Comment) {
    mark.dataset.commentId = c.id;
    mark.tabIndex = 0;
    mark.setAttribute("role", "button");
    mark.setAttribute("aria-label", c.body || "Open highlight");
    setAnnotationTooltip(mark);
    mark.onclick = () => {
      if (mark.ownerDocument.getSelection()?.isCollapsed === false) return;
      void this.openReadingControls(file, c.id, mark);
    };
    mark.onkeydown = (event) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        void this.openReadingControls(file, c.id, mark, true);
      }
    };
  }
  private async openReadingControls(
    file: TFile,
    id: string,
    mark: HTMLElement,
    keyboard = false,
  ) {
    const activation = ++this.readingActivation;
    this.readingControls?.popup.close();
    try {
      const snapshot = await this.note(file);
      if (
        this.unloaded ||
        activation !== this.readingActivation ||
        !mark.isConnected
      )
        return;
      const record = snapshot.error
        ? undefined
        : snapshot.records.find(
            (c) =>
              c.id === id &&
              c.status === "open" &&
              c.target.state === "attached",
          );
      if (!record) return;
      const popup = new ReadingAnnotationControls(
        mark,
        record,
        (fn) => this.change(file, fn),
        Platform.isMobileApp,
        () => {
          if (this.readingControls?.popup === popup)
            this.readingControls = undefined;
        },
        () => this.paletteSettings.visibleColors,
      );
      this.readingControls = { file, popup };
      if (keyboard) popup.focusControls();
    } catch (error) {
      new Notice(error instanceof Error ? error.message : String(error));
    }
  }
}
class CommentModal extends Modal {
  constructor(
    private plugin: CommentsPlugin,
    private titleText: string,
    private comment: Comment | undefined,
    private save: (body: string, color: Color, author: string) => void,
  ) {
    super(plugin.app);
  }
  onOpen() {
    this.titleEl.setText(this.titleText);
    this.contentEl.addClass("comments-compose");
    const label = this.contentEl.createEl("label", { text: "Comment" });
    const text = this.contentEl.createEl("textarea", {
      attr: {
        rows: "6",
        placeholder: "Write your comment…",
        "aria-label": "Comment",
      },
    });
    label.htmlFor = text.id = "comments-body";
    text.value = this.comment?.body || "";
    const details = this.contentEl.createDiv({
      cls: "comments-compose-details",
    });
    const colorField = details.createEl("label", { text: "Color" });
    const color = colorField.createEl("select", {
      attr: { "aria-label": "Comment color" },
    });
    for (const c of COLORS)
      color.createEl("option", {
        text: c[0].toUpperCase() + c.slice(1),
        value: c,
      });
    color.value = this.comment?.color || "yellow";
    const controls = this.contentEl.createDiv({ cls: "comments-actions" });
    const cancel = controls.createEl("button", { text: "Cancel" });
    cancel.onclick = () => this.close();
    const save = controls.createEl("button", {
      text: "Save comment",
      cls: "mod-cta",
    });
    const submit = () => {
      if (!text.value.trim()) {
        text.focus();
        return;
      }
      this.save(
        text.value.trim(),
        color.value as Color,
        this.comment?.author || this.plugin.author,
      );
      this.close();
    };
    save.onclick = submit;
    text.onkeydown = (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
        e.preventDefault();
        submit();
      }
    };
    text.focus();
  }
}
interface CommentRow {
  node: HTMLElement;
  record: Comment;
}
function sameVisibleComment(a: Comment, b: Comment): boolean {
  return (
    a.author === b.author &&
    a.body === b.body &&
    a.color === b.color &&
    a.status === b.status &&
    a.kind === b.kind &&
    a.native === b.native &&
    a.target.before === b.target.before &&
    a.target.after === b.target.after &&
    a.target.quote === b.target.quote &&
    a.target.originalQuote === b.target.originalQuote &&
    a.target.state === b.target.state
  );
}
class CommentsView extends ItemView {
  filter = "open";
  color = "all";
  query = "";
  timer: number | undefined;
  private timerWindow: Window | undefined;
  generation = 0;
  private file: TFile | null | undefined;
  private error: string | undefined;
  private subtitle: HTMLElement | undefined;
  private statusButtons = new Map<string, HTMLButtonElement>();
  private filterControl: HTMLButtonElement | undefined;
  private resetFilters: HTMLButtonElement | undefined;
  private searchControl: HTMLInputElement | undefined;
  private list: HTMLElement | undefined;
  private records: Comment[] = [];
  private rows = new Map<string, CommentRow>();
  private selection: string[] | undefined;
  private checked = new SidebarSelection();
  private shown: Comment[] = [];
  private selectButton: HTMLButtonElement | undefined;
  private bulkBar: HTMLElement | undefined;
  private selectAll: HTMLInputElement | undefined;
  private selectionCount: HTMLElement | undefined;
  private bulkResolve: HTMLButtonElement | undefined;
  private bulkReopen: HTMLButtonElement | undefined;
  private bulkDelete: HTMLButtonElement | undefined;
  private bulkBusy = false;
  constructor(
    leaf: WorkspaceLeaf,
    private plugin: CommentsPlugin,
  ) {
    super(leaf);
  }
  getViewType() {
    return VIEW;
  }
  getDisplayText() {
    return "Annotations";
  }
  getIcon() {
    return "message-square";
  }
  async onOpen() {
    await this.render();
  }
  async onClose() {
    this.timerWindow?.clearTimeout(this.timer);
    this.generation++;
    this.rows.clear();
  }
  schedule() {
    if (!this.containerEl.isShown()) return;
    this.timerWindow?.clearTimeout(this.timer);
    this.timerWindow = this.containerEl.win;
    this.timer = this.timerWindow.setTimeout(() => void this.render(), 150);
  }
  async render() {
    this.plugin.applyPalette(this.containerEl.ownerDocument);
    const token = ++this.generation,
      file = this.plugin.activeFile();
    let p: NoteSnapshot | undefined;
    try {
      p = file ? await this.plugin.note(file) : undefined;
    } catch {
      p = withLines({
        document: "",
        records: [],
        start: 0,
        error: "Unable to read this note. Reopen it to try again.",
      });
    }
    if (token !== this.generation) return;
    if (this.file !== file || this.error !== p?.error || !this.subtitle) {
      this.checked.exit();
      this.shown = [];
      this.file = file;
      this.error = p?.error;
      this.rows.clear();
      this.list = undefined;
      const root = this.contentEl;
      root.empty();
      root.addClass("comments-panel");
      root.removeClass("is-selecting");
      root.onkeydown = (event) => {
        if (this.bulkBusy) return;
        const target = event.target as HTMLElement;
        if (
          target.closest("input,textarea,[contenteditable=true]") &&
          !target.matches('input[type="checkbox"]')
        )
          return;
        if (event.key === "Escape" && this.checked.active) {
          event.preventDefault();
          event.stopPropagation();
          this.checked.exit();
          this.syncSelection();
          this.selectButton?.focus();
        } else if (
          (event.metaKey || event.ctrlKey) &&
          event.key.toLowerCase() === "a" &&
          this.shown.length
        ) {
          event.preventDefault();
          event.stopPropagation();
          this.checked.all(this.shown.map((c) => c.id));
          this.syncSelection();
        }
      };
      this.statusButtons.clear();
      const top = root.createDiv({ cls: "comments-panel-top" });
      const head = top.createDiv({ cls: "comments-header" }),
        heading = head.createDiv({ cls: "comments-heading" });
      heading.createEl("h2", { text: "Annotations" });
      const tools = head.createDiv({ cls: "comments-tools" });
      this.selectButton = tools.createEl("button", {
        cls: "comments-select-mode",
        text: "Select",
        attr: { type: "button" },
      });
      this.selectButton.onclick = () => {
        if (this.bulkBusy) return;
        if (this.checked.active) this.checked.exit();
        else this.checked.active = true;
        this.syncSelection();
      };
      const filterButton = (this.filterControl = tools.createEl("button", {
        cls: "clickable-icon comments-icon",
        attr: {
          type: "button",
          "aria-label": "Filter annotations",
          title: "Filter annotations",
        },
      }));
      setIcon(filterButton, "list-filter");
      filterButton.onclick = () => this.openFilters(filterButton);

      this.subtitle = top.createEl("p", {
        text: file?.basename || "No note selected",
        cls: "comments-subtitle",
      });
      if (!file) {
        filterButton.disabled = this.selectButton.disabled = true;
        root.createEl("p", {
          text: "Open a Markdown note to see its annotations.",
          cls: "comments-empty",
        });
        return;
      }
      if (p?.error) {
        filterButton.disabled = this.selectButton.disabled = true;
        root.createEl("p", {
          text: p.error,
          cls: "comments-error",
          attr: { role: "alert" },
        });
        return;
      }
      const searchWrap = top.createDiv({ cls: "comments-search" });
      const search = (this.searchControl = searchWrap.createEl("input", {
        attr: {
          type: "search",
          placeholder: "Search annotations…",
          "aria-label": "Search annotations",
        },
      }));
      search.value = this.query;
      search.oninput = () => {
        this.query = search.value;
        this.syncControls();
        this.renderCards();
      };
      search.onkeydown = (event) => {
        if (event.key === "Escape") {
          event.preventDefault();
          event.stopPropagation();
          this.query = "";
          this.syncControls();
          this.renderCards();
        }
      };
      const statuses = top.createDiv({
        cls: "comments-statuses",
        attr: { role: "group", "aria-label": "Filter by status" },
      });
      for (const [value, label] of [
        ["open", "Open"],
        ["resolved", "Resolved"],
        ["all", "All"],
      ]) {
        const button = statuses.createEl("button", {
          text: label,
          attr: { type: "button" },
        });
        this.statusButtons.set(value, button);
        button.onclick = () => {
          this.filter = value;
          this.syncControls();
          this.renderCards();
        };
      }
      this.resetFilters = top.createEl("button", {
        cls: "comments-filter-summary",
        attr: { type: "button", "aria-label": "Clear annotation filters" },
      });
      this.resetFilters.onclick = () => this.clearFilters();
      this.bulkBar = top.createDiv({
        cls: "comments-bulk",
        attr: { role: "group", "aria-label": "Selected annotations" },
      });
      const selectLine = this.bulkBar.createDiv({
        cls: "comments-selection-summary",
      });
      const allLabel = selectLine.createEl("label", {
        cls: "comments-select-all",
      });
      this.selectAll = allLabel.createEl("input", {
        attr: {
          type: "checkbox",
          "aria-label": "Select all shown annotations",
        },
      });
      allLabel.createSpan({ text: "Select all shown" });
      this.selectAll.onchange = () => {
        if (this.selectAll?.checked)
          this.checked.all(this.shown.map((c) => c.id));
        else this.checked.clear();
        this.syncSelection();
      };
      this.selectionCount = selectLine.createSpan({
        attr: { role: "status", "aria-live": "polite" },
      });
      const bulkActions = this.bulkBar.createDiv({
        cls: "comments-bulk-actions",
      });
      this.bulkResolve = bulkActions.createEl("button", {
        text: "Resolve",
        attr: { type: "button" },
      });
      this.bulkResolve.onclick = () => void this.applyBulk("resolved");
      this.bulkReopen = bulkActions.createEl("button", {
        text: "Reopen",
        attr: { type: "button" },
      });
      this.bulkReopen.onclick = () => void this.applyBulk("open");
      this.bulkDelete = bulkActions.createEl("button", {
        text: "Delete",
        attr: { type: "button" },
      });
      this.bulkDelete.onclick = () => this.deleteSelected();
      this.list = root.createDiv({ cls: "comments-list" });
    }
    if (this.subtitle && this.subtitle.textContent !== file?.basename)
      this.subtitle.setText(file?.basename || "No note selected");
    if (!this.list || !p || p.error) return;
    this.records = p.records;
    this.syncControls();
    this.renderCards();
  }
  private syncControls() {
    for (const [value, button] of this.statusButtons) {
      const count =
        value === "all"
          ? this.records.length
          : this.records.filter((c) => c.status === value).length;
      const label =
        value === "all" ? "All" : value === "open" ? "Open" : "Resolved";
      const text = `${label}${count}`;
      if (button.textContent !== text) {
        button.setText(label);
        button.createSpan({
          cls: "comments-status-count",
          text: String(count),
        });
      }
      button.setAttribute("aria-label", `${label} annotations (${count})`);
      button.setAttribute("aria-pressed", String(this.filter === value));
    }
    if (this.searchControl && this.searchControl.value !== this.query)
      this.searchControl.value = this.query;
    const filtered = this.color !== "all" || this.filter === "detached";
    this.filterControl?.setAttribute("aria-pressed", String(filtered));
    if (this.resetFilters) {
      this.resetFilters.hidden = !filtered;
      this.resetFilters.setText(
        [
          this.color !== "all"
            ? this.color[0].toUpperCase() + this.color.slice(1)
            : "",
          this.filter === "detached" ? "Needs reattachment" : "",
        ]
          .filter(Boolean)
          .join(" · ") + " ×",
      );
    }
  }
  private clearFilters() {
    this.filter = "all";
    this.color = "all";
    this.query = "";
    this.syncControls();
    this.renderCards();
  }
  private openFilters(button: HTMLButtonElement) {
    const menu = new Menu();
    for (const color of ["all", ...COLORS])
      menu.addItem((item) =>
        item
          .setTitle(
            color === "all"
              ? "All colors"
              : color[0].toUpperCase() + color.slice(1),
          )
          .setChecked(this.color === color)
          .onClick(() => {
            this.color = color;
            this.syncControls();
            this.renderCards();
          }),
      );
    menu.addSeparator();
    menu.addItem((item) =>
      item
        .setTitle("Needs reattachment")
        .setIcon("link")
        .setChecked(this.filter === "detached")
        .onClick(() => {
          this.filter = this.filter === "detached" ? "open" : "detached";
          this.syncControls();
          this.renderCards();
        }),
    );
    const rect = button.getBoundingClientRect();
    menu.showAtPosition({ x: rect.left, y: rect.bottom });
  }
  private renderCards() {
    const list = this.list,
      file = this.file;
    if (!list || !file) return;
    const query = this.query.toLowerCase();
    const shown = this.records.filter(
      (c) =>
        (this.filter === "all" ||
          (this.filter === "detached" && c.target.state === "detached") ||
          c.status === this.filter) &&
        (this.color === "all" || c.color === this.color) &&
        (!query || `${c.body} ${c.target.quote}`.toLowerCase().includes(query)),
    );
    shown.sort(
      (a, b) =>
        Number(a.target.state === "detached") -
          Number(b.target.state === "detached") ||
        a.target.from - b.target.from,
    );
    this.shown = shown;
    this.checked.retain(shown.map((c) => c.id));
    const activeControl = list.ownerDocument.activeElement;
    const focused = activeControl?.closest<HTMLElement>(".comments-card");
    const focusedId = focused?.dataset.commentId;
    const previousOrder = Array.from(list.children).map(
      (node) => (node as HTMLElement).dataset.commentId,
    );
    const previousIndex = focusedId ? previousOrder.indexOf(focusedId) : -1;
    const ids = new Set(shown.map((c) => c.id));
    for (const [id, row] of this.rows)
      if (!ids.has(id)) {
        row.node.remove();
        this.rows.delete(id);
      }
    if (!shown.length) {
      const text = this.records.length
        ? "No matching annotations."
        : "Select a passage to highlight it or leave a note.";
      let empty = list.querySelector<HTMLElement>(".comments-empty");
      if (!empty) empty = list.createEl("p", { cls: "comments-empty" });
      if (empty.querySelector(".comments-empty-text")?.textContent !== text) {
        empty.empty();
        empty.createSpan({ cls: "comments-empty-text", text });
        if (this.records.length) {
          const clear = empty.createEl("button", {
            cls: "comments-clear-filters",
            text: "Clear filters",
            attr: { type: "button" },
          });
          clear.onclick = () => {
            this.clearFilters();
            this.searchControl?.focus();
          };
        }
      }
      if (focused && activeControl && !activeControl.isConnected)
        this.statusButtons.get(this.filter)?.focus();
      this.syncSelection();
      return;
    }
    list.querySelector(".comments-empty")?.remove();
    let cursor = list.firstElementChild;
    const selection = new Set(this.plugin.selected);
    for (const c of shown) {
      let row = this.rows.get(c.id);
      if (!row) {
        row = { node: list.createEl("article"), record: c };
        this.fillRow(row, file);
        this.rows.set(c.id, row);
      } else {
        const same = sameVisibleComment(row.record, c);
        row.record = c;
        if (!same) this.fillRow(row, file);
      }
      if (row.node.classList.contains("is-selected") !== selection.has(c.id))
        row.node.toggleClass("is-selected", selection.has(c.id));
      if (row.node === cursor) cursor = cursor.nextElementSibling;
      else list.insertBefore(row.node, cursor);
    }
    if (focused && activeControl && !activeControl.isConnected) {
      const next =
        shown[Math.max(0, Math.min(previousIndex, shown.length - 1))];
      this.rows
        .get(next.id)
        ?.node.querySelector<HTMLButtonElement>(".comments-primary")
        ?.focus();
    }
    this.syncSelection();
    if (this.selection !== this.plugin.selected) {
      this.selection = this.plugin.selected;
      const selected = shown.find((c) => selection.has(c.id));
      if (selected) {
        const node = this.rows.get(selected.id)!.node;
        if (node.isConnected) node.scrollIntoView({ block: "nearest" });
      }
    }
  }
  private syncSelection() {
    const chosen = this.shown.filter((c) => this.checked.ids.has(c.id));
    this.contentEl.toggleClass("is-selecting", this.checked.active);
    this.selectButton?.setText(this.checked.active ? "Done" : "Select");
    if (this.selectButton) {
      this.selectButton.disabled =
        this.bulkBusy || (!this.shown.length && !this.checked.active);
      this.selectButton.setAttribute(
        "aria-pressed",
        String(this.checked.active),
      );
    }
    if (this.bulkBar) this.bulkBar.hidden = !this.checked.active;
    if (this.selectAll) {
      this.selectAll.checked =
        !!this.shown.length && chosen.length === this.shown.length;
      this.selectAll.indeterminate =
        chosen.length > 0 && chosen.length < this.shown.length;
      this.selectAll.disabled = !this.shown.length || this.bulkBusy;
    }
    const countText = `${chosen.length} selected`;
    if (this.selectionCount?.textContent !== countText)
      this.selectionCount?.setText(countText);
    if (this.bulkResolve)
      this.bulkResolve.disabled =
        this.bulkBusy || !chosen.some((c) => c.status === "open");
    if (this.bulkReopen)
      this.bulkReopen.disabled =
        this.bulkBusy || !chosen.some((c) => c.status === "resolved");
    if (this.bulkDelete)
      this.bulkDelete.disabled = this.bulkBusy || !chosen.length;
    for (const [id, row] of this.rows) {
      row.node.toggleClass("is-checked", this.checked.ids.has(id));
      const input = row.node.querySelector<HTMLInputElement>(
        ".comments-row-check input",
      );
      if (input) {
        input.checked = this.checked.ids.has(id);
        input.disabled = this.bulkBusy;
      }
      for (const primary of row.node.querySelectorAll<HTMLButtonElement>(
        ".comments-primary, .comments-edit-note",
      )) {
        const action = this.checked.active
          ? "Select annotation"
          : primary.classList.contains("comments-edit-note")
            ? "Edit note"
            : "Go to text";
        primary.setAttribute("aria-description", action);
        primary.title = action;
        if (this.checked.active)
          primary.setAttribute(
            "aria-pressed",
            String(this.checked.ids.has(id)),
          );
        else primary.removeAttribute("aria-pressed");
      }
    }
  }
  private async applyBulk(status: "open" | "resolved") {
    if (!this.file || this.bulkBusy || !this.checked.ids.size) return;
    const file = this.file,
      ids = new Set(this.checked.ids);
    this.bulkBusy = true;
    this.syncSelection();
    try {
      const saved = await this.plugin.change(file, (records) =>
        records.map((c) =>
          ids.has(c.id) && c.status !== status
            ? { ...c, status, updated: new Date().toISOString() }
            : c,
        ),
      );
      if (saved && this.file === file) {
        this.checked.clear();
        await this.render();
      }
    } finally {
      this.bulkBusy = false;
      this.syncSelection();
    }
  }
  private deleteSelected() {
    if (!this.file || this.bulkBusy || !this.checked.ids.size) return;
    const file = this.file;
    const selected = this.shown.filter((c) => this.checked.ids.has(c.id));
    const snapshot = new Map(selected.map((c) => [c.id, JSON.stringify(c)]));
    const modal = new Modal(this.app);
    modal.titleEl.setText(
      `Delete ${selected.length} annotation${selected.length === 1 ? "" : "s"}?`,
    );
    modal.contentEl.createEl("p", {
      text: `This removes the selected highlights and their notes from “${file.basename}”.`,
    });
    const actions = modal.contentEl.createDiv({ cls: "comments-actions" });
    const cancel = actions.createEl("button", { text: "Cancel" });
    cancel.onclick = () => modal.close();
    const remove = actions.createEl("button", {
      text: "Delete annotations",
      cls: "mod-warning",
    });
    remove.onclick = () => {
      if (this.bulkBusy) return;
      this.bulkBusy = true;
      remove.disabled = true;
      this.syncSelection();
      void this.plugin
        .change(file, (records) => {
          for (const c of records)
            if (snapshot.has(c.id) && snapshot.get(c.id) !== JSON.stringify(c))
              throw new Error(
                "An annotation changed. Review the selection before deleting.",
              );
          return records.filter((c) => !snapshot.has(c.id));
        })
        .then(async (saved) => {
          if (saved) {
            modal.close();
            if (this.file === file) {
              this.checked.clear();
              await this.render();
            }
          }
        })
        .finally(() => {
          this.bulkBusy = false;
          remove.disabled = false;
          this.syncSelection();
        });
    };
    modal.open();
    cancel.focus();
  }
  private fillRow(row: CommentRow, file: TFile) {
    const c = row.record,
      card = row.node;
    card.empty();
    card.className = `comments-card comments-${c.color}`;
    card.setAttribute("data-comment-id", c.id);
    card.setAttribute(
      "aria-label",
      `${c.color} ${c.body ? "comment" : "highlight"}${c.status === "resolved" ? ", resolved" : ""}`,
    );
    const top = card.createDiv({ cls: "comments-card-heading" });
    const checkboxLabel = top.createEl("label", { cls: "comments-row-check" });
    const checkbox = checkboxLabel.createEl("input", {
      attr: {
        type: "checkbox",
        "aria-label": "Select annotation",
        "aria-description": c.body || c.target.quote || "Entire file",
      },
    });
    checkbox.onclick = (event) => {
      if (this.bulkBusy) return;
      this.checked.toggle(
        c.id,
        this.shown.map((item) => item.id),
        event.shiftKey,
      );
      this.syncSelection();
    };
    const content = top.createDiv({ cls: "comments-card-content" });
    const primary = content.createEl("button", {
      cls: "comments-primary comments-target",
      attr: {
        type: "button",
        "aria-description": "Go to text",
      },
    });
    const passage = sidebarPassage(c);
    primary.createSpan({
      cls: "comments-passage-context",
      text: (c.kind === "file" ? "" : "“") + passage.before,
    });
    primary.createSpan({ cls: "comments-highlight-text", text: passage.quote });
    primary.createSpan({
      cls: "comments-passage-context",
      text: passage.after + (c.kind === "file" ? "" : "”"),
    });
    const actions = top.createDiv({ cls: "comments-row-actions" });
    if (c.target.state === "detached")
      card.createEl("p", {
        text: "Needs reattachment",
        cls: "comments-warning",
      });
    if (c.status === "resolved")
      card.createSpan({ text: "Resolved", cls: "comments-resolved" });
    const iconButton = (label: string, icon: string, fn: () => void) => {
      const b = actions.createEl("button", {
        cls: "clickable-icon comments-icon",
        attr: { "aria-label": label, title: label },
      });
      setIcon(b, icon);
      b.onclick = fn;
      return b;
    };
    const update = (fn: (current: Comment) => Comment) =>
      void this.plugin.change(file, (rs) =>
        rs.map((x) => (x.id === row.record.id ? fn(x) : x)),
      );
    const editNote = () => {
      const current = row.record;
      new CommentModal(
        this.plugin,
        current.body ? "Edit note" : "Add note",
        current,
        (body, color, author) =>
          update((x) => {
            if (x.body !== current.body || x.updated !== current.updated)
              throw new Error("This annotation changed. Open it again.");
            return {
              ...x,
              body,
              color,
              author,
              updated: new Date().toISOString(),
            };
          }),
      ).open();
    };
    const activate = (event: MouseEvent, action: () => void) => {
      if (
        this.checked.active ||
        event.ctrlKey ||
        event.metaKey ||
        event.shiftKey
      ) {
        this.checked.toggle(
          c.id,
          this.shown.map((item) => item.id),
          event.shiftKey,
        );
        this.syncSelection();
      } else action();
    };
    primary.onclick = (event) =>
      activate(event, () => void this.plugin.navigate(file, row.record));
    if (c.body) {
      const note = content.createEl("button", {
        cls: "comments-edit-note",
        text: c.body,
        attr: { type: "button", "aria-description": "Edit note" },
      });
      note.onclick = (event) => activate(event, editNote);
    } else {
      const context = content.createDiv({ cls: "comments-card-context" });
      const add = context.createEl("button", {
        cls: "comments-add-note",
        text: "Add note",
        attr: { type: "button" },
      });
      add.onclick = editNote;
    }
    const more = iconButton("Comment actions", "ellipsis", () => {
      const c = row.record,
        menu = new Menu();
      menu.addItem((i) =>
        i
          .setTitle(c.body ? "Edit note" : "Add note")
          .setIcon("pencil")
          .onClick(editNote),
      );
      menu.addItem((i) =>
        i
          .setTitle(c.status === "open" ? "Resolve" : "Reopen")
          .setIcon(c.status === "open" ? "check" : "undo-2")
          .onClick(() =>
            update((x) => ({
              ...x,
              status: x.status === "open" ? "resolved" : "open",
              updated: new Date().toISOString(),
            })),
          ),
      );
      menu.addItem((i) =>
        i
          .setTitle("Select")
          .setIcon("list-checks")
          .onClick(() => {
            this.checked.toggle(
              c.id,
              this.shown.map((item) => item.id),
            );
            this.syncSelection();
          }),
      );
      menu.addItem((i) =>
        i
          .setTitle("Reattach")
          .setIcon("link")
          .onClick(() => {
            this.plugin.reattaching = c.id;
            this.plugin.reattachFile = file;
            new Notice(
              "Select the new target in this note, then run “Annotations: Reattach selected comment to selection”.",
            );
          }),
      );
      menu.addSeparator();
      menu.addItem((i) =>
        i
          .setTitle("Delete")
          .setIcon("trash-2")
          .setWarning(true)
          .onClick(() => {
            const modal = new Modal(this.app);
            modal.titleEl.setText("Delete this comment?");
            modal.contentEl.createEl("p", { text: c.body });
            const b = modal.contentEl.createEl("button", {
              text: "Delete comment",
              cls: "mod-warning",
            });
            b.onclick = () => {
              void this.plugin.change(file, (rs) => {
                const current = rs.find((x) => x.id === c.id);
                if (current && JSON.stringify(current) !== JSON.stringify(c))
                  throw new Error("Comment changed; review before deleting.");
                return rs.filter((x) => x.id !== c.id);
              });
              modal.close();
            };
            modal.open();
          }),
      );
      const rect = more.getBoundingClientRect();
      menu.showAtPosition({ x: rect.left, y: rect.bottom });
    });
  }
}
