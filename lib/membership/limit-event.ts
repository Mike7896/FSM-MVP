/**
 * The Free job limit, as the browser hears about it (Billing §3.1).
 *
 * A send refused at the limit answers with `details.reason = "free_limit"`.
 * Whichever form made the request calls `reportFreeLimit` with the error, and
 * the one `FreeLimitSheet` mounted in the app shell opens over the draft —
 * the screen it interrupted — instead of every send form growing its own
 * upgrade prompt. Client-safe.
 */

export const FREE_LIMIT_EVENT = "serviceclerk:free-limit";

export type FreeLimitDetail = {
  used: number;
  limit: number;
  resetsAt: string;
};

export function reportFreeLimit(error: unknown): boolean {
  const details = (error as { details?: { reason?: string } } | null | undefined)?.details;
  if (typeof window === "undefined" || details?.reason !== "free_limit") return false;
  window.dispatchEvent(
    new CustomEvent<FreeLimitDetail>(FREE_LIMIT_EVENT, {
      detail: details as unknown as FreeLimitDetail,
    })
  );
  return true;
}
