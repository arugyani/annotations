import type { Rect } from "@codemirror/view";

/** Keep the dock at one edge for a selection, without scrolling its content. */
export class MobileDockPlacement {
  private atTop = false;

  update(
    dom: HTMLElement,
    ceiling: number,
    floor: number,
    targets: readonly Rect[],
  ) {
    const height = dom.getBoundingClientRect().height;
    if (
      !this.atTop &&
      height > 0 &&
      targets.some(
        (target) =>
          target.bottom > target.top &&
          target.top < floor &&
          target.bottom > Math.max(ceiling, floor - height - 12),
      )
    )
      this.atTop = true;
    dom.classList.toggle("is-docked-top", this.atTop);
    dom.style.setProperty("--comments-dock-top", `${ceiling}px`);
  }

  reset() {
    this.atTop = false;
  }
}
