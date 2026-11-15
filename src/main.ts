import {
  Plugin,
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
  Setting,
  PluginSettingTab,
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
import { readAuthor } from "./settings";
import { editorUX, toggleStoredData, composeSelection } from "./editor-ui";
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
  author = "Me";
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
  async onload() {
    this.author = readAuthor(await this.loadData());
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
    this.addSettingTab(new CommentsSettings(this.app, this));
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
        (ids) => void this.reveal(ids),
        (view, _snapshot) => {
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
      this.app.workspace.on("active-leaf-change", () => this.refresh()),
    );
    this.registerEvent(
      this.app.workspace.on("editor-change", (_editor, info) => {
        if (info.file === this.activeFile()) this.refresh();
      }),
    );
    this.registerEvent(
      this.app.vault.on("modify", (file) => {
        if (file instanceof TFile) this.readNotes.delete(file);
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
        if (file === this.currentFile) {
          this.currentFile = null;
          this.refresh();
        }
      }),
    );
  }
  async onExternalSettingsChange() {
    this.author = readAuthor(await this.loadData());
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
            const a = parse(old);
            e.replaceRange(
              next.slice(a.start),
              e.offsetToPos(a.start),
              e.offsetToPos(old.length),
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
        return [
          ...records,
          newComment(document, from, to, kind, body, author, color),
        ];
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
    const file = this.app.vault.getAbstractFileByPath(ctx.sourcePath);
    if (!(file instanceof TFile)) return;
    const layer = new MarkdownRenderChild(el),
      marks: HTMLElement[] = [];
    let disposed = false;
    layer.register(() => {
      disposed = true;
      for (const mark of marks)
        mark.replaceWith(...Array.from(mark.childNodes));
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
    // Keep Reading view free of annotation controls. Exact single-node quotations
    // are interactive highlights; transformed/overlapping ranges remain in the sidebar.
    for (const c of relevant) {
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
        const mark = document.createElement("mark");
        mark.className = `comments-highlight comments-${c.color}`;
        mark.tabIndex = 0;
        mark.setAttribute("role", "button");
        mark.setAttribute("aria-label", c.body || "Open highlight");
        setAnnotationTooltip(mark);
        mark.onclick = () => {
          void this.reveal([c.id]);
        };
        mark.onkeydown = (event) => {
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            void this.reveal([c.id]);
          }
        };
        range.surroundContents(mark);
        marks.push(mark);
      }
    }
  }
}
class CommentsSettings extends PluginSettingTab {
  constructor(
    app: CommentsPlugin["app"],
    private plugin: CommentsPlugin,
  ) {
    super(app, plugin);
  }
  getSettingDefinitions() {
    return [
      {
        name: "Comment author",
        desc: "Stored in the Markdown file with every new comment.",
        render: (setting: Setting) => this.configure(setting),
      },
    ];
  }
  // Older Obsidian versions call display; newer versions use searchable definitions.
  display() {
    this.containerEl.empty();
    this.configure(
      new Setting(this.containerEl)
        .setName("Comment author")
        .setDesc("Stored in the Markdown file with every new comment."),
    );
  }
  private configure(setting: Setting) {
    setting.addText((t) =>
      t.setValue(this.plugin.author).onChange((value) => {
        this.plugin.author = value.trim() || "Me";
        void this.plugin
          .saveData({ author: this.plugin.author })
          .catch(() => new Notice("Unable to save annotation settings."));
      }),
    );
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
    const authorField = details.createEl("label", { text: "Author" });
    const colorField = details.createEl("label", { text: "Color" });
    const author = authorField.createEl("input", {
      attr: { "aria-label": "Author", placeholder: "Author" },
    });
    author.value = this.comment?.author || this.plugin.author;
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
        author.value.trim() || "Me",
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
  private searchButton: HTMLButtonElement | undefined;
  private searchWrap: HTMLElement | undefined;
  private searchExpanded = false;
  private count: HTMLElement | undefined;
  private searchControl: HTMLInputElement | undefined;
  private list: HTMLElement | undefined;
  private records: Comment[] = [];
  private rows = new Map<string, CommentRow>();
  private selection: string[] | undefined;
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
      this.file = file;
      this.error = p?.error;
      this.rows.clear();
      this.list = undefined;
      const root = this.contentEl;
      root.empty();
      root.addClass("comments-panel");
      this.statusButtons.clear();
      const head = root.createDiv({ cls: "comments-header" }),
        heading = head.createDiv({ cls: "comments-heading" });
      heading.createEl("h2", { text: "Annotations" });
      this.count = heading.createSpan({ cls: "comments-count" });
      const tools = head.createDiv({ cls: "comments-tools" });
      const searchButton = (this.searchButton = tools.createEl("button", {
        cls: "clickable-icon comments-icon",
        attr: {
          type: "button",
          "aria-label": "Search comments",
          title: "Search comments",
        },
      }));
      setIcon(searchButton, "search");
      searchButton.onclick = () => {
        this.searchExpanded = !this.searchExpanded;
        if (!this.searchExpanded) this.query = "";
        this.syncControls();
        this.renderCards();
        if (this.searchExpanded) this.searchControl?.focus();
      };
      const filterButton = (this.filterControl = tools.createEl("button", {
        cls: "clickable-icon comments-icon",
        attr: {
          type: "button",
          "aria-label": "Filter comments",
          title: "Filter comments",
        },
      }));
      setIcon(filterButton, "list-filter");
      filterButton.onclick = () => this.openFilters(filterButton);

      this.subtitle = root.createEl("p", {
        text: file?.basename || "No note selected",
        cls: "comments-subtitle",
      });
      if (!file) {
        searchButton.disabled = filterButton.disabled = true;
        this.count.setText("");
        root.createEl("p", {
          text: "Open a Markdown note to see its comments.",
          cls: "comments-empty",
        });
        return;
      }
      if (p?.error) {
        searchButton.disabled = filterButton.disabled = true;
        this.count.setText("");
        root.createEl("p", {
          text: p.error,
          cls: "comments-error",
          attr: { role: "alert" },
        });
        return;
      }
      const statuses = root.createDiv({
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
      this.searchWrap = root.createDiv({ cls: "comments-search" });
      const search = (this.searchControl = this.searchWrap.createEl("input", {
        attr: {
          type: "search",
          placeholder: "Search comments…",
          "aria-label": "Search comments",
        },
      }));
      search.value = this.query;
      search.oninput = () => {
        this.query = search.value;
        this.renderCards();
      };
      search.onkeydown = (event) => {
        if (event.key === "Escape") {
          event.preventDefault();
          this.query = "";
          this.searchExpanded = false;
          this.syncControls();
          this.renderCards();
          this.searchButton?.focus();
        }
      };
      this.resetFilters = root.createEl("button", {
        cls: "comments-filter-summary",
        attr: { type: "button", "aria-label": "Clear comment filters" },
      });
      this.resetFilters.onclick = () => {
        this.filter = "all";
        this.color = "all";
        this.syncControls();
        this.renderCards();
      };
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
    if (this.count) this.count.setText(String(this.records.length));
    for (const [value, button] of this.statusButtons) {
      const count =
        value === "all"
          ? this.records.length
          : this.records.filter((c) => c.status === value).length;
      const label =
        value === "all" ? "All" : value === "open" ? "Open" : "Resolved";
      const text = `${label} ${count}`;
      if (button.textContent !== text) button.setText(text);
      button.setAttribute("aria-label", `${label} comments`);
      button.setAttribute("aria-pressed", String(this.filter === value));
    }
    if (this.searchControl && this.searchControl.value !== this.query)
      this.searchControl.value = this.query;
    const searching = this.searchExpanded || !!this.query;
    if (this.searchWrap) this.searchWrap.hidden = !searching;
    this.searchButton?.setAttribute("aria-expanded", String(searching));
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
        (!query ||
          `${c.body} ${c.author} ${c.target.quote}`
            .toLowerCase()
            .includes(query)),
    );
    const ids = new Set(shown.map((c) => c.id));
    for (const [id, row] of this.rows)
      if (!ids.has(id)) {
        row.node.remove();
        this.rows.delete(id);
      }
    if (!shown.length) {
      const text = this.records.length
        ? "No comments here. Try another filter."
        : "Select a passage to highlight it or leave a note.";
      let empty = list.querySelector<HTMLElement>(".comments-empty");
      if (!empty) empty = list.createEl("p", { cls: "comments-empty" });
      if (empty.textContent !== text) empty.setText(text);
      return;
    }
    list.querySelector(".comments-empty")?.remove();
    let cursor = list.firstElementChild;
    const selection = new Set(this.plugin.selected);
    for (const c of shown) {
      let row = this.rows.get(c.id);
      if (!row) {
        row = { node: list.ownerDocument.createElement("article"), record: c };
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
    if (this.selection !== this.plugin.selected) {
      this.selection = this.plugin.selected;
      const selected = shown.find((c) => selection.has(c.id));
      if (selected) {
        const node = this.rows.get(selected.id)!.node;
        if (node.isConnected) node.scrollIntoView({ block: "nearest" });
      }
    }
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
    const target = card.createEl("button", {
      text:
        c.kind === "file"
          ? "Entire file"
          : c.target.quote || c.target.originalQuote,
      cls: "comments-target",
    });
    target.title = "Navigate to target";
    target.onclick = () => void this.plugin.navigate(file, row.record);
    if (c.target.state === "detached")
      card.createEl("p", {
        text: "Needs reattachment",
        cls: "comments-warning",
      });
    if (c.body) card.createEl("p", { text: c.body, cls: "comments-body" });
    const foot = card.createDiv({ cls: "comments-row-footer" }),
      meta = foot.createDiv({ cls: "comments-meta" });
    if (c.status === "resolved")
      meta.createSpan({ text: "Resolved", cls: "comments-resolved" });
    const actions = foot.createDiv({ cls: "comments-row-actions" });
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
    if (!c.body) {
      const add = iconButton("Add note", "message-square-plus", () => {
        const current = row.record;
        new CommentModal(
          this.plugin,
          "Add note",
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
      });
      add.addClass("comments-add-note");
    }
    iconButton(
      c.status === "open" ? "Resolve" : "Reopen",
      c.status === "open" ? "check" : "undo-2",
      () =>
        update((x) => ({
          ...x,
          status: x.status === "open" ? "resolved" : "open",
          updated: new Date().toISOString(),
        })),
    );
    const more = iconButton("Comment actions", "ellipsis", () => {
      const c = row.record,
        menu = new Menu();
      menu.addItem((i) =>
        i
          .setTitle("Edit")
          .setIcon("pencil")
          .onClick(() =>
            new CommentModal(
              this.plugin,
              "Edit comment",
              c,
              (body, color, author) =>
                update((x) => {
                  if (x.updated !== c.updated || x.body !== c.body)
                    throw new Error(
                      "Comment changed while editing. Open it again.",
                    );
                  return {
                    ...x,
                    body,
                    color,
                    author,
                    updated: new Date().toISOString(),
                  };
                }),
            ).open(),
          ),
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
