/**
 * A typed sentence, read for what it says and nothing more.
 *
 * "Miller - the dead outlet" names a customer and a job. That is all a sentence
 * can honestly give: a job's rows and prices are the contractor's, and guessing
 * them from keywords produced numbers that were wrong for every job the list
 * didn't happen to know — for an electrician, most of them. So a quote started
 * from a sentence opens with its customer and title filled in and an empty
 * Scope, and the onboarding tour shows how to fill it.
 *
 * When there is an AI that can draft real rows from a real description, it
 * plugs in here. Its rows carry `source: "ai_drafted"`, which is what puts the
 * EST badge on a number the contractor hasn't agreed to yet.
 */

import { emptyDraft } from "./draft";
import type { QuoteDraft } from "./types";

export type ParsedSeed = {
  /** Everything before the separator — usually a name. */
  customer: string;
  /** Everything after it — what the job is. */
  work: string;
  raw: string;
};

/**
 * Splits "Dana Whitfield — 200A panel upgrade" into a customer and the work.
 *
 * The separator set is wide on purpose — a contractor typing one line at speed
 * uses whatever punctuation is under their thumb, and the promise was "however
 * you'd say it out loud".
 */
export function parseSeed(raw: string): ParsedSeed {
  const input = raw.trim();

  // Em dash, en dash, hyphen surrounded by spaces, colon, or the first comma.
  const match = input.match(/^(.+?)\s*(?:—|–|\s-\s|:|,)\s*(.+)$/);

  return {
    customer: match ? match[1].trim() : "",
    work: (match ? match[2] : input).trim(),
    raw: input,
  };
}

/** A new quote named by the sentence — its customer and title, nothing invented. */
export function draftFromSeed(
  seed: ParsedSeed,
  base?: Partial<QuoteDraft>
): QuoteDraft {
  return emptyDraft({
    customerName: seed.customer,
    title: titleOf(seed.work),
    ...base,
  });
}

/** "the dead outlet" → "Dead outlet". Articles are how people talk, not job names. */
function titleOf(work: string): string {
  const trimmed = work.trim().replace(/^(?:the|a|an)\s+/i, "");
  return trimmed ? trimmed.charAt(0).toUpperCase() + trimmed.slice(1) : "";
}
