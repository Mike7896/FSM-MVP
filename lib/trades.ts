/**
 * The trades the one-tap question offers — screen 16a.
 *
 * Ids are what the Office stores; labels are what the buttons say. "Something
 * else" is a real answer rather than a skip, which is why it has an id.
 *
 * Plain data with no server imports, so the question on the client and the
 * endpoint that saves the answer read the same list.
 */
export const TRADE_IDS = [
  "electrical",
  "plumbing",
  "hvac",
  "remodel",
  "roofing",
  "other",
] as const;

export type TradeId = (typeof TRADE_IDS)[number];

export const TRADE_LABELS: Record<TradeId, string> = {
  electrical: "Electrical",
  plumbing: "Plumbing",
  hvac: "HVAC",
  remodel: "Remodel",
  roofing: "Roofing",
  other: "Something else",
};

export function isTradeId(value: unknown): value is TradeId {
  return (
    typeof value === "string" && (TRADE_IDS as readonly string[]).includes(value)
  );
}

/**
 * The trade a front door names. `/for/electricians` sends `?trade=electricians`
 * to signup, and anyone who came in that way has already answered the
 * question — they never see it.
 */
export function tradeFromDoor(value: string | null | undefined): TradeId | null {
  if (!value) return null;
  const doors: Record<string, TradeId> = {
    electricians: "electrical",
    plumbers: "plumbing",
    roofers: "roofing",
    remodelers: "remodel",
  };
  const key = value.trim().toLowerCase();
  return doors[key] ?? (isTradeId(key) ? key : null);
}
