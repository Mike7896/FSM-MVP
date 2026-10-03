import { applicationFeeFor } from "@/lib/membership/catalog";

/**
 * WHAT TAKING A PAYMENT ONLINE COSTS — said the same way everywhere the
 * contractor meets it: setting up payments, sending an invoice, reading what
 * came in.
 *
 * Stripe's figures are its **published standard US pricing**, which is what a
 * new connected account pays; Stripe takes them from the payment before it
 * lands. ServiceClerk's bank-payment fee is a separate, smaller cut and only
 * applies once it's switched on (Billing §8.2, §10.1). The customer pays the
 * invoice amount either way — every fee comes out of the contractor's side.
 *
 * The amounts here are estimates for showing in advance. What was actually
 * taken comes from Stripe and is recorded in the ledger per payment.
 */

export const CARD_PERCENT = 2.9;
export const CARD_FIXED_CENTS = 30;
export const BANK_PERCENT = 0.8;
export const BANK_CAP_CENTS = 500;

export type FeeEstimate = {
  /** What Stripe takes. */
  stripeCents: number;
  /** What ServiceClerk takes. */
  oursCents: number;
  totalCents: number;
};

/** A card payment of this amount: 2.9% + 30¢, all of it Stripe's. */
export function cardFee(amountCents: number): FeeEstimate {
  const stripeCents =
    amountCents > 0 ? Math.round(amountCents * (CARD_PERCENT / 100)) + CARD_FIXED_CENTS : 0;
  return { stripeCents, oursCents: 0, totalCents: stripeCents };
}

/** A bank (ACH) payment of this amount: 0.8% capped at $5, plus ours when it's on. */
export function bankFee(amountCents: number, oursOn: boolean): FeeEstimate {
  const stripeCents =
    amountCents > 0
      ? Math.min(BANK_CAP_CENTS, Math.round(amountCents * (BANK_PERCENT / 100)))
      : 0;
  const oursCents = oursOn ? applicationFeeFor("ach", amountCents) : 0;
  return { stripeCents, oursCents, totalCents: stripeCents + oursCents };
}

/** The two rates, in words, for a table or a sentence. */
export function feeRates(oursOn: boolean) {
  return {
    card: `${CARD_PERCENT}% + ${CARD_FIXED_CENTS}¢`,
    bank: oursOn
      ? `${BANK_PERCENT}% (max $5) + 0.2% to ServiceClerk (max $5)`
      : `${BANK_PERCENT}% (max $5)`,
  };
}
