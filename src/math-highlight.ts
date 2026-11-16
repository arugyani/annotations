/** Background bands follow rendered lines, never individual symbols or table cells. */
export function mathHighlightBackground(element: HTMLElement): string {
  const math = element.querySelector<HTMLElement>("mjx-math");
  if (!math) return "none";
  const origin = element.getBoundingClientRect();
  const table =
    math.children.length === 1 &&
    math.firstElementChild?.tagName === "MJX-MTABLE"
      ? math.firstElementChild
      : null;
  const rows = table?.querySelectorAll(
    ":scope > mjx-table > mjx-itable > mjx-mtr",
  );
  const groups = rows?.length
    ? Array.from(rows, (row) =>
        Array.from(row.querySelectorAll(":scope > mjx-mtd > :not(mjx-tstrut)")),
      )
    : [[math]];
  return (
    groups
      .flatMap((group) => {
        const rects = group
          .map((node) => node.getBoundingClientRect())
          .filter((rect) => rect.width > 0 && rect.height > 0);
        if (!rects.length) return [];
        const left = Math.min(...rects.map((r) => r.left)) - origin.left - 1;
        const top = Math.min(...rects.map((r) => r.top)) - origin.top - 1;
        const right = Math.max(...rects.map((r) => r.right)) - origin.left + 1;
        const bottom = Math.max(...rects.map((r) => r.bottom)) - origin.top + 1;
        const box = `${left.toFixed(2)}px ${top.toFixed(2)}px / ${(right - left).toFixed(2)}px ${(bottom - top).toFixed(2)}px no-repeat`;
        const line = `${left.toFixed(2)}px ${bottom.toFixed(2)}px / ${(right - left).toFixed(2)}px 1px no-repeat`;
        return [
          `linear-gradient(color-mix(in srgb, var(--comment-tint) 65%, transparent), color-mix(in srgb, var(--comment-tint) 65%, transparent)) ${box}`,
          `linear-gradient(var(--comment-ink), var(--comment-ink)) ${line}`,
        ];
      })
      .join(", ") || "none"
  );
}
