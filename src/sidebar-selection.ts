/** Selection is limited to the current visible list, never hidden search results. */
export class SidebarSelection {
  active = false;
  ids = new Set<string>();
  private anchor: string | undefined;
  toggle(id: string, visible: readonly string[], range = false) {
    if (!visible.includes(id)) return;
    this.active = true;
    const from = this.anchor ? visible.indexOf(this.anchor) : -1;
    const to = visible.indexOf(id);
    if (range && from >= 0) {
      for (const key of visible.slice(
        Math.min(from, to),
        Math.max(from, to) + 1,
      ))
        this.ids.add(key);
    } else {
      if (this.ids.has(id)) this.ids.delete(id);
      else this.ids.add(id);
      this.anchor = id;
    }
  }
  all(visible: readonly string[]) {
    this.active = true;
    this.ids = new Set(visible);
  }
  clear() {
    this.ids.clear();
    this.anchor = undefined;
  }
  exit() {
    this.active = false;
    this.clear();
  }
  retain(visible: readonly string[]) {
    const allowed = new Set(visible);
    for (const id of this.ids) if (!allowed.has(id)) this.ids.delete(id);
    if (this.anchor && !allowed.has(this.anchor)) this.anchor = undefined;
  }
}
