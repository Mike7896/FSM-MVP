/**
 * THE LEDGER — the truth of what money *moved*.
 *
 * Documents say what is **owed**; this says what **moved**. Both exist and
 * neither subsumes the other, because money routinely moves with no document
 * behind it (a chargeback seven months later, a partial refund, Stripe's fee, a
 * bank payout) and an obligation is not a movement (a signed contract creates
 * $10,000 of owed money and moves nothing).
 *
 * Two modules, and the split is the point:
 *
 * - `entries` — the **one door in**. Every webhook, matcher and form goes
 *   through `recordEntry`, and a wrong row is corrected with `reverseEntry`
 *   rather than an edit, because nothing here is ever updated or deleted.
 * - `fold` — the way out. Collected to date, the shop-wide totals, the job's
 *   timeline. All of them are `sum` over an ordered array.
 */

export * from "./entries";
export * from "./fold";
