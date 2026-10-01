/** A page the request is about, as the help pages pass it along — a path, or nothing. */
export function pageFrom(value: string | string[] | undefined): string | null {
  if (typeof value !== "string") return null;
  // Only a path in this app: never a full address, never somebody's query string.
  return /^\/[\w\-/]*$/.test(value) && !value.startsWith("//") && value.length <= 300 ? value : null;
}

/** The contact page for a kind, carrying the page along. */
export function contactHref(kind: "bug" | "idea" | "help", from: string | null) {
  const params = new URLSearchParams({ kind });
  if (from) params.set("from", from);
  return `/help/contact?${params}`;
}
