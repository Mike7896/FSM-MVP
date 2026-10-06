/** The viewed state is itself tracking data, even without a timestamp. */
export function visibleQuoteStatus<T extends string>(status: T, viewTracking: boolean): T | "sent" {
  return !viewTracking && status === "viewed" ? "sent" : status;
}
