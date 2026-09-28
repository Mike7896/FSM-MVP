/**
 * **Each kind of paper has its own ink** — a band across the top and the
 * document's name printed in it, the way pre-printed forms come in colours.
 * On a job's rail the quote and the contract it became carry the same
 * letterhead, customer and rows; the colour is what tells them apart from
 * across the room, before a word is read — and the full page prints its name
 * in the same ink, so the miniature and the page it stands for match.
 *
 * Written out in full: Tailwind only ships classes it finds as literal strings.
 */
const INK: Record<string, { band: string; word: string; dot: string }> = {
  quote: { band: "bg-amber-400", word: "text-amber-600", dot: "bg-amber-400" },
  contract: { band: "bg-emerald-500", word: "text-emerald-700", dot: "bg-emerald-500" },
  "change order": { band: "bg-violet-500", word: "text-violet-700", dot: "bg-violet-500" },
  invoice: { band: "bg-sky-500", word: "text-sky-700", dot: "bg-sky-500" },
};

/** The ink for a document type — "Quote", "Contract", "Change order", "Invoice". */
export function inkFor(documentType: string | undefined) {
  return INK[(documentType ?? "quote").toLowerCase()] ?? INK.quote;
}
