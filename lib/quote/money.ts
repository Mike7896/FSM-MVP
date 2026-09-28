/**
 * Money, in one place.
 *
 * Every number the contractor types passes through `parseMoney` and every
 * number he reads comes out of `formatMoney`. Centralising both is what keeps
 * "$1,240.00", "1240", "1,240" and "1240." from being four different bugs.
 */

/** Cents → "$1,240" or "$1,240.50". Whole amounts drop the decimals. */
export function formatMoney(cents: number, options?: { forceCents?: boolean }) {
  const showCents = options?.forceCents || cents % 100 !== 0;
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: showCents ? 2 : 0,
    maximumFractionDigits: showCents ? 2 : 0,
  }).format(cents / 100);
}

/** A change of money: "+$1,250", "−$300", "$0" — it has a direction. */
export function formatChange(cents: number) {
  if (cents === 0) return formatMoney(0);
  return `${cents > 0 ? "+" : "−"}${formatMoney(Math.abs(cents))}`;
}

/** Cents → the string that goes in a text input for editing. */
export function moneyInputValue(cents: number | null): string {
  if (cents === null) return "";
  return (cents / 100).toFixed(2);
}

/**
 * A typed amount → cents, or null when there is no number in it.
 *
 * Deliberately forgiving about what a contractor types on a phone: currency
 * symbols, thousands separators and trailing junk are all stripped rather than
 * rejected. Rounding happens once, here, so a half-cent can never survive into
 * the draft and compound across a re-render.
 */
export function parseMoney(input: string): number | null {
  const cleaned = input.replace(/[^0-9.\-]/g, "");
  if (cleaned === "" || cleaned === "-" || cleaned === ".") return null;
  const value = Number(cleaned);
  if (!Number.isFinite(value)) return null;
  return Math.round(value * 100);
}

/**
 * A typed quantity → a number with at most three decimals, matching the
 * `numeric(12,3)` column. Rounding here rather than at the database means the
 * total on screen is the total that gets stored.
 */
export function parseQuantity(input: string): number | null {
  const cleaned = input.replace(/[^0-9.]/g, "");
  if (cleaned === "" || cleaned === ".") return null;
  const value = Number(cleaned);
  if (!Number.isFinite(value) || value < 0) return null;
  return Math.round(value * 1000) / 1000;
}

/** Drops a trailing ".000" so quantities read as "2" rather than "2.000". */
export function formatQuantity(quantity: number): string {
  return String(Math.round(quantity * 1000) / 1000);
}

/**
 * Sell price derived from cost and markup — the direction the price book works
 * in. Rounded to the cent at the unit, not at the line, because the customer
 * sees a unit price and it has to be the one that was multiplied.
 */
export function sellFromCost(
  unitCostCents: number,
  markupPercent: number
): number {
  return Math.round(unitCostCents * (1 + markupPercent / 100));
}

/** The inverse, for when the contractor types the sell price directly. */
export function markupFromSell(
  unitCostCents: number,
  sellPriceCents: number
): number | null {
  if (unitCostCents <= 0) return null;
  return Math.round(((sellPriceCents - unitCostCents) / unitCostCents) * 1000) / 10;
}

/** A percentage of an amount, rounded once. */
export function percentOf(cents: number, percent: number): number {
  return Math.round(cents * (percent / 100));
}
