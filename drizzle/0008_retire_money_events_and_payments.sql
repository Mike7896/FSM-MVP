DROP TABLE "payments" CASCADE;--> statement-breakpoint
DROP TABLE "money_events" CASCADE;--> statement-breakpoint
DROP TYPE "public"."money_event_type";--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- What this migration retires, and why.
--
-- `money_events` was the append-only money log written for the QuickBooks
-- brief, and it never had a caller: nothing in the codebase read it or wrote
-- it. It is replaced in 0009 by `ledger_entries`, which differs on every axis
-- that matters — it is cash-only rather than mixed, its `job_id` is nullable
-- so a Stripe payout can be recorded at all, its amounts are signed, it has a
-- total order to fold along, and it has a way to correct a wrong row.
--
-- `payments` was the source of "collected" on six surfaces. It goes because it
-- is the same fact as a `payment_received` entry kept in a second place, and
-- the ledger exists precisely so that a contractor's money does not have two
-- answers. Everything it recorded, the ledger records; several things it could
-- not record — a refund with no invoice, a chargeback, a fee, a payout — the
-- ledger records too.
--
-- CASCADE takes the append-only trigger down with its table. The function it
-- called is schema-level and outlives the drop, so it goes explicitly.
-- ---------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.money_events_are_append_only();
