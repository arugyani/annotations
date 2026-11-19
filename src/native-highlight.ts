import { ChangeSet, Text, type ChangeSpec } from "@codemirror/state";
import { anchor, type Color, type Comment } from "./model";

export const NATIVE_EMOJI: Record<Color, string> = {
  yellow: "🟡",
  blue: "🔵",
  green: "🟢",
  purple: "🟣",
  red: "🔴",
  orange: "🟠",
};

/** Deliberately narrow: ordinary text on one line, outside Markdown constructs. */
export function canUseNative(
  document: string,
  from: number,
  to: number,
  records: Comment[],
): boolean {
  if (from >= to || from < 0 || to > document.length) return false;
  const precedingSource = document.slice(0, from);
  if (precedingSource.lastIndexOf("<!--") > precedingSource.lastIndexOf("-->"))
    return false;
  const text = document.slice(from, to);
  if (!text.trim() || text !== text.trim() || /[\n\r`*$[\]<>_=|\\]/.test(text))
    return false;
  if (
    records.some(
      (c) =>
        c.kind !== "file" &&
        c.target.state === "attached" &&
        c.target.from < to &&
        c.target.to > from,
    )
  )
    return false;
  const start = document.lastIndexOf("\n", from - 1) + 1;
  const end = document.indexOf("\n", to);
  let line = document.slice(start, end < 0 ? document.length : end);
  if (/^(?: {4}|\t)/.test(line)) return false;
  for (const match of line.matchAll(/==(?:[🟡🔵🟢🟣🔴🟠])?([^=\n]+)==/gu)) {
    if (
      start + match.index < to &&
      start + match.index + match[0].length > from
    )
      return false;
  }
  line = line.replace(/==(?:[🟡🔵🟢🟣🔴🟠])?([^=\n]+)==/gu, (match) =>
    " ".repeat(match.length),
  );
  if (
    /[`*$[\]<>_=|\\]/.test(line) ||
    /(?:https?:\/\/|mailto:|www\.)/.test(line)
  )
    return false;
  const prefix =
    line.match(/^\s*(?:#{1,6}\s+|>\s*|[-+]\s+|\d+[.)]\s+)/)?.[0] ?? "";
  if (from < start + prefix.length) return false;
  let fence = "",
    math = false,
    comment = false,
    frontmatter = /^\uFEFF?---\r?\n/.test(document);
  for (const [index, previous] of document
    .slice(0, start)
    .split("\n")
    .entries()) {
    if (frontmatter) {
      if (index > 0 && /^(?:---|\.\.\.)\s*$/.test(previous))
        frontmatter = false;
      continue;
    }
    const plain = previous.replace(/^\s*>\s?/, "");
    const match = plain.match(/^\s{0,3}(`{3,}|~{3,})/);
    if (match) {
      if (!fence) fence = match[1];
      else if (match[1][0] === fence[0] && match[1].length >= fence.length)
        fence = "";
    }
    if (!fence && !match) {
      if ((plain.match(/\$\$/g)?.length ?? 0) % 2) math = !math;
      if ((plain.match(/%%/g)?.length ?? 0) % 2) comment = !comment;
    }
  }
  const paragraphStart = document.lastIndexOf("\n\n", start - 1) + 2;
  const preceding = document
    .slice(Math.max(0, paragraphStart), start)
    .replace(/==(?:[🟡🔵🟢🟣🔴🟠])?([^=\n]+)==/gu, "");
  return (
    !fence &&
    !frontmatter &&
    !math &&
    !comment &&
    !/[`*$[\]<>_=|\\]/.test(preceding)
  );
}

type NativeSource = string | Pick<Text, "sliceString" | "length">;
export function nativeSpan(document: NativeSource, record: Comment) {
  const { from, to } = record.target;
  if (to + 2 > document.length) return undefined;
  const slice = (a: number, b: number) =>
    typeof document === "string"
      ? document.slice(a, b)
      : document.sliceString(a, b);
  if (slice(to, to + 2) !== "==") return undefined;
  for (const [color, emoji] of Object.entries(NATIVE_EMOJI)) {
    const prefix = `==${emoji}`;
    if (slice(Math.max(0, from - prefix.length), from) === prefix)
      return { from: from - prefix.length, to: to + 2, color: color as Color };
  }
  if (slice(Math.max(0, from - 2), from) === "==")
    return { from: from - 2, to: to + 2, color: "yellow" as Color };
  return undefined;
}

/** Source syntax owns color. Removing its delimiters preserves a detached note. */
export function refreshNative(
  document: NativeSource,
  record: Comment,
): Comment {
  if (
    !record.native ||
    record.status !== "open" ||
    record.target.state !== "attached"
  )
    return record;
  const span = nativeSpan(document, record);
  if (!span)
    return { ...record, target: { ...record.target, state: "detached" } };
  return span.color === record.color
    ? record
    : { ...record, color: span.color };
}

/** Apply syntax and metadata together, preserving every unrelated annotation. */
export function nativeChanges(
  document: string,
  before: Comment[],
  after: Comment[],
) {
  const changes: ChangeSpec[] = [];
  const previous = new Map(before.map((c) => [c.id, c]));
  const next = new Map(after.map((c) => [c.id, c]));
  const active = (c: Comment | undefined) =>
    !!c?.native && c.status === "open" && c.target.state === "attached";
  for (const old of before) {
    if (!active(old)) continue;
    const span = nativeSpan(document, old),
      current = next.get(old.id);
    if (!span) continue;
    if (
      !active(current) ||
      current!.target.from !== old.target.from ||
      current!.target.to !== old.target.to
    ) {
      changes.push(
        { from: span.from, to: old.target.from, insert: "" },
        { from: old.target.to, to: span.to, insert: "" },
      );
    } else if (current!.color !== span.color) {
      changes.push({
        from: span.from,
        to: old.target.from,
        insert: `==${NATIVE_EMOJI[current!.color]}`,
      });
    }
  }
  for (const current of after) {
    const old = previous.get(current.id);
    if (!active(current)) continue;
    if (
      active(old) &&
      nativeSpan(document, old!) &&
      old!.target.from === current.target.from &&
      old!.target.to === current.target.to
    )
      continue;
    if (
      !canUseNative(
        document,
        current.target.from,
        current.target.to,
        after.filter((c) => c.id !== current.id),
      )
    )
      throw new Error(
        "This selection cannot use native highlighting. Select ordinary text again.",
      );
    changes.push(
      { from: current.target.from, insert: `==${NATIVE_EMOJI[current.color]}` },
      { from: current.target.to, insert: "==" },
    );
  }
  const set = ChangeSet.of(changes, document.length);
  if (set.empty) return { document, records: after, changes: set };
  const source = set.apply(Text.of(document.split("\n"))).toString();
  const records = after.map((c) => {
    if (c.kind === "file" || c.target.state === "detached") return c;
    const from = set.mapPos(c.target.from, 1),
      to = set.mapPos(c.target.to, -1);
    return { ...c, target: anchor(source, from, to, c.target.originalQuote) };
  });
  return { document: source, records, changes: set };
}
