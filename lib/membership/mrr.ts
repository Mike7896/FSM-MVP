import type Stripe from "stripe";

/**
 * MONTHLY RECURRING REVENUE — what one subscription brings in a month, in cents.
 *
 * Every licensed recurring line counts (the core plan *and* any packs), at its
 * quantity, spread to a month. Discounts still running come off: a percentage
 * from the whole, a fixed amount once per invoice. A once-only coupon doesn't
 * recur, so it doesn't lower MRR. Tax is never in it.
 *
 * Null when the answer can't be read in full — a price with no flat amount, a
 * discount Stripe didn't expand — so the caller can say "list price" rather
 * than show a number that's quietly wrong.
 */
export function monthlyRecurringCents(
  subscription: Pick<Stripe.Subscription, "items" | "discounts">,
  now = Date.now()
): number | null {
  let gross = 0;
  let invoicesPerMonth: number | null = null;

  for (const item of subscription.items.data) {
    const recurring = item.price.recurring;
    if (!recurring || recurring.usage_type === "metered") continue;
    if (item.price.unit_amount === null) return null;
    const perMonth = perMonthFactor(recurring.interval, recurring.interval_count);
    if (perMonth === null) return null;
    gross += item.price.unit_amount * (item.quantity ?? 1) * perMonth;
    invoicesPerMonth ??= perMonth;
  }

  let net = gross;
  for (const discount of subscription.discounts ?? []) {
    if (typeof discount === "string") return null;
    if (discount.end !== null && discount.end * 1000 <= now) continue;
    const coupon = discount.source?.coupon;
    if (!coupon || typeof coupon === "string") return null;
    if (coupon.duration === "once") continue;
    if (coupon.percent_off) net -= net * (coupon.percent_off / 100);
    else if (coupon.amount_off) net -= coupon.amount_off * (invoicesPerMonth ?? 1);
  }

  return Math.max(0, Math.round(net));
}

function perMonthFactor(interval: Stripe.Price.Recurring.Interval, count: number) {
  const every = Math.max(count, 1);
  switch (interval) {
    case "day":
      return 365 / 12 / every;
    case "week":
      return 52 / 12 / every;
    case "month":
      return 1 / every;
    case "year":
      return 1 / 12 / every;
    default:
      return null;
  }
}
