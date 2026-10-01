-- ServiceClerk's ACH fee can come back (Billing §8.3): when a homeowner
-- payment is refunded or returned, the matching share of the application fee
-- is handed back to the contractor. That return is written as a *positive*
-- `application_fee` row, so fee totals net out and nothing about it counts as
-- money collected. Every other signed type keeps its rule.

ALTER TABLE "ledger_entries" DROP CONSTRAINT IF EXISTS "ledger_entries_sign_matches_type";--> statement-breakpoint
ALTER TABLE "ledger_entries" ADD CONSTRAINT "ledger_entries_sign_matches_type" CHECK (
  "ledger_entries"."reverses_id" is not null
  or "ledger_entries"."entry_type" = 'adjustment'
  or "ledger_entries"."entry_type" = 'application_fee'
  or ("ledger_entries"."entry_type" in ('payment_received', 'chargeback_reversed') and "ledger_entries"."amount_cents" > 0)
  or ("ledger_entries"."entry_type" in ('refund_issued', 'chargeback_opened', 'processing_fee', 'payout') and "ledger_entries"."amount_cents" < 0)
);
