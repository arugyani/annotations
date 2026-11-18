import { COLORS, type Color, type Comment } from "./model";

export type BindComposeKeys = (
  textarea: HTMLTextAreaElement,
  save: () => void,
  cancel: () => void,
) => () => void;

export interface AnnotationControlsHost {
  current(): Comment | undefined;
  composing(): boolean;
  beginNote(): void;
  setComposing(open: boolean): void;
  color(color: Color): void | Promise<void>;
  save(body: string): void | Promise<void>;
  close(): void;
  focus(): void;
  measure(): void;
}

/** Shared controls; each host owns persistence and conflict checks. */
export function annotationControls(
  document: Document,
  host: AnnotationControlsHost,
  bindKeys?: BindComposeKeys,
) {
  const dom = document.adoptNode(createDiv());
  dom.className = "comments-selection-tooltip";
  const pill = dom.createDiv();
  pill.className = "comments-selection-pill";
  pill.setAttribute("role", "toolbar");
  pill.setAttribute("aria-label", "Annotate selection");
  const swatches = new Map<Color, HTMLButtonElement>();
  let panel: HTMLElement | undefined;
  let textarea: HTMLTextAreaElement | undefined;
  let error: HTMLElement | undefined;
  let save: HTMLButtonElement | undefined;
  let releaseKeys: (() => void) | undefined;
  let busy = false;
  let destroyed = false;

  function run(action: () => void | Promise<void>) {
    if (busy || destroyed) return;
    busy = true;
    const done = () => {
      busy = false;
      if (!destroyed) update();
    };
    const fail = (reason: unknown) => {
      if (destroyed) return;
      host.setComposing(true);
      openPanel();
      if (error) {
        error.textContent =
          reason instanceof Error ? reason.message : String(reason);
        error.hidden = false;
      }
    };
    try {
      const pending = action();
      if (pending) {
        update();
        void pending.catch(fail).finally(done);
      } else done();
    } catch (reason) {
      fail(reason);
      done();
    }
  }
  for (const color of COLORS) {
    const button = pill.createEl("button");
    button.type = "button";
    button.className = `comments-swatch comments-${color}`;
    button.title = `Highlight ${color}`;
    button.setAttribute("aria-label", button.title);
    button.setAttribute("aria-pressed", "false");
    button.createSpan().setAttribute("aria-hidden", "true");
    button.onmousedown = (event) => event.preventDefault();
    button.onclick = () => run(() => host.color(color));
    swatches.set(color, button);
  }
  const separator = pill.createSpan();
  separator.className = "comments-pill-separator";
  separator.setAttribute("aria-hidden", "true");
  function iconButton(cls: string, label: string, pathData: string) {
    const button = pill.createEl("button");
    button.type = "button";
    button.className = cls;
    button.setAttribute("aria-label", label);
    button.title = label;
    const svg = button.createSvg("svg");
    for (const [key, value] of Object.entries({
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
      svg.setAttribute(key, value);
    svg.createSvg("path").setAttribute("d", pathData);
    button.onmousedown = (event) => event.preventDefault();
    return button;
  }
  const note = iconButton(
    "comments-selection-note",
    "Add note",
    "M21 11.5a8.4 8.4 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.4 8.4 0 0 1-3.8-.9L3 21l1.9-5.7a8.4 8.4 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.4 8.4 0 0 1 3.8-.9H13a8.5 8.5 0 0 1 8 8v.5Z",
  );
  note.onclick = () => {
    host.setComposing(!host.composing());
    update();
    textarea?.focus();
  };
  const close = iconButton(
    "comments-selection-close",
    "Close annotation controls",
    "M6 6l12 12M18 6 6 18",
  );
  close.onclick = () => host.close();
  dom.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && !host.composing()) {
      event.preventDefault();
      event.stopPropagation();
      host.close();
    }
  });

  function closePanel() {
    releaseKeys?.();
    releaseKeys = undefined;
    panel?.remove();
    panel = textarea = error = save = undefined;
  }
  function openPanel() {
    if (panel || destroyed) return;
    host.beginNote();
    panel = dom.createDiv();
    panel.className = "comments-inline-compose";
    panel.setAttribute("role", "group");
    panel.setAttribute("aria-label", "Note for selected text");
    textarea = panel.createEl("textarea");
    textarea.placeholder = "Write a note…";
    textarea.setAttribute("aria-label", "Note for selected text");
    textarea.rows = 3;
    textarea.value = host.current()?.body ?? "";
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
      host.setComposing(false);
      update();
      host.focus();
    };
    save = actions.createEl("button");
    save.type = "button";
    save.className = "mod-cta";
    save.textContent = "Save note";
    const enableSave = () => {
      if (save) save.disabled = busy || !textarea?.value.trim();
    };
    textarea.oninput = enableSave;
    enableSave();
    const submit = () => {
      const body = textarea?.value.trim();
      if (body) run(() => host.save(body));
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
    host.measure();
  }
  function update() {
    if (destroyed) return;
    const current = host.current();
    for (const [color, button] of swatches) {
      button.setAttribute("aria-pressed", String(current?.color === color));
      button.disabled = busy;
    }
    const label = current?.body ? "Edit note" : "Add note";
    note.setAttribute("aria-label", label);
    note.title = label;
    note.disabled = busy;
    if (host.composing()) openPanel();
    else closePanel();
    if (save) save.disabled = busy || !textarea?.value.trim();
  }
  update();
  return {
    dom,
    update,
    mount: () => {
      update();
      textarea?.focus();
    },
    destroy: () => {
      destroyed = true;
      closePanel();
    },
  };
}

export function styleMobileControls(dom: HTMLElement) {
  const pill = dom.querySelector<HTMLElement>(".comments-selection-pill");
  if (!pill) return;
  const colors = pill.createDiv();
  colors.className = "comments-mobile-colors mod-raised";
  for (const swatch of pill.querySelectorAll(".comments-swatch"))
    colors.appendChild(swatch);
  pill.prepend(colors);
  pill.querySelector(".comments-pill-separator")?.remove();
  for (const button of pill.querySelectorAll(
    ".comments-selection-note, .comments-selection-close",
  ))
    button.classList.add("mod-raised");
}
