import { emptyDraft } from "./draft";
import type { QuoteDraft } from "./types";

/** Explicit fields take precedence. Old one-line links remain readable without
 * guessing which punctuation belongs to a customer's name. */
export function draftFromStart({ customerName, title, seedText }: {
  customerName?: string;
  title?: string;
  seedText?: string;
}): QuoteDraft {
  return emptyDraft({
    customerName: (customerName ?? "").trim().slice(0, 160),
    title: (title ?? seedText ?? "").trim().slice(0, 200),
  });
}
