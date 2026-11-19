import type { Comment } from "./model";

/** A short, single-line context window; the highlighted quotation stays intact. */
export function sidebarPassage(record: Comment) {
  if (record.kind === "file")
    return { before: "", quote: "Entire file", after: "" };
  let { before, after } = record.target;
  if (record.native) {
    before = before.replace(/==(?:[🟡🔵🟢🟣🔴🟠])?$/u, "");
    after = after.replace(/^==/, "");
  }
  before = before.split(/\r?\n/).at(-1) ?? "";
  after = after.split(/\r?\n/)[0];
  // Do not show syntax from other complete native highlights in the window.
  const plain = (text: string) =>
    text.replace(/==(?:[🟡🔵🟢🟣🔴🟠])?([^=]+)==/gu, "$1");
  before = plain(before);
  after = plain(after);
  const limit = 48;
  if (before.length > limit) {
    const tail = before.slice(-limit);
    const boundary = tail.search(/\s/);
    before = "…" + (boundary >= 0 ? tail.slice(boundary) : tail);
  }
  if (after.length > limit) {
    const head = after.slice(0, limit);
    const boundary = head.search(/\s+\S*$/);
    after = (boundary > 0 ? head.slice(0, boundary) : head) + "…";
  }
  return {
    before: before.trimStart(),
    quote: record.target.quote || record.target.originalQuote,
    after: after.trimEnd(),
  };
}
