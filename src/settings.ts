/** Settings may be absent, edited by hand, or replaced by a sync update. */
export function readAuthor(value: unknown): string {
  if (!value || typeof value !== "object" || !("author" in value)) return "Me";
  return typeof value.author === "string" ? value.author.trim() || "Me" : "Me";
}
