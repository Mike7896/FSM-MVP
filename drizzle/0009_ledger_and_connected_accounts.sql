CREATE TYPE "public"."connected_account_status" AS ENUM('onboarding', 'pending', 'active', 'restricted', 'disabled');--> statement-breakpoint
CREATE TYPE "public"."ledger_entry_type" AS ENUM('payment_received', 'refund_issued', 'chargeback_opened', 'chargeback_reversed', 'processing_fee', 'application_fee', 'payout', 'adjustment');--> statement-breakpoint
CREATE TYPE "public"."ledger_source" AS ENUM('stripe', 'plaid_match', 'manual');--> statement-breakpoint
CREATE TABLE "connected_accounts" (
	"organization_id" uuid PRIMARY KEY NOT NULL,
	"stripe_account_id" text NOT NULL,
	"status" "connected_account_status" DEFAULT 'onboarding' NOT NULL,
	"charges_enabled" boolean DEFAULT false NOT NULL,
	"payouts_enabled" boolean DEFAULT false NOT NULL,
	"details_submitted" boolean DEFAULT false NOT NULL,
	"requirements_due" text[],
	"disabled_reason" text,
	"business_name" text,
	"default_currency" text DEFAULT 'usd' NOT NULL,
	"application_fee_bps" integer DEFAULT 0 NOT NULL,
	"dashboard_type" text DEFAULT 'express' NOT NULL,
	"losses_payments" text DEFAULT 'stripe' NOT NULL,
	"onboarded_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "connected_accounts_stripe_account_id_unique" UNIQUE("stripe_account_id")
);
--> statement-breakpoint
CREATE TABLE "ledger_entries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"seq" bigserial NOT NULL,
	"organization_id" uuid NOT NULL,
	"job_id" uuid,
	"invoice_id" uuid,
	"customer_id" uuid,
	"entry_type" "ledger_entry_type" NOT NULL,
	"amount_cents" bigint NOT NULL,
	"currency" char(3) DEFAULT 'usd' NOT NULL,
	"occurred_at" timestamp with time zone NOT NULL,
	"recorded_at" timestamp with time zone DEFAULT now() NOT NULL,
	"source" "ledger_source" NOT NULL,
	"method" "payment_method",
	"external_ref" text,
	"reverses_id" uuid,
	"memo" text,
	"created_by" uuid,
	CONSTRAINT "ledger_entries_payout_has_no_job" CHECK ("ledger_entries"."entry_type" <> 'payout' or "ledger_entries"."job_id" is null),
	CONSTRAINT "ledger_entries_adjustment_has_memo" CHECK ("ledger_entries"."entry_type" <> 'adjustment'
        or ("ledger_entries"."memo" is not null and length(btrim("ledger_entries"."memo")) > 0)),
	CONSTRAINT "ledger_entries_amount_nonzero" CHECK ("ledger_entries"."amount_cents" <> 0),
	CONSTRAINT "ledger_entries_sign_matches_type" CHECK ("ledger_entries"."reverses_id" is not null
        or "ledger_entries"."entry_type" = 'adjustment'
        or ("ledger_entries"."entry_type" in (
              'payment_received', 'chargeback_reversed'
            ) and "ledger_entries"."amount_cents" > 0)
        or ("ledger_entries"."entry_type" in (
              'refund_issued', 'chargeback_opened',
              'processing_fee', 'application_fee', 'payout'
            ) and "ledger_entries"."amount_cents" < 0))
);
--> statement-breakpoint
ALTER TABLE "connected_accounts" ADD CONSTRAINT "connected_accounts_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ledger_entries" ADD CONSTRAINT "ledger_entries_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ledger_entries" ADD CONSTRAINT "ledger_entries_job_id_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."jobs"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ledger_entries" ADD CONSTRAINT "ledger_entries_invoice_id_invoices_id_fk" FOREIGN KEY ("invoice_id") REFERENCES "public"."invoices"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ledger_entries" ADD CONSTRAINT "ledger_entries_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ledger_entries" ADD CONSTRAINT "ledger_entries_reverses_id_ledger_entries_id_fk" FOREIGN KEY ("reverses_id") REFERENCES "public"."ledger_entries"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ledger_entries" ADD CONSTRAINT "ledger_entries_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "auth"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "connected_accounts_stripe_id_idx" ON "connected_accounts" USING btree ("stripe_account_id");--> statement-breakpoint
CREATE INDEX "ledger_entries_job_idx" ON "ledger_entries" USING btree ("organization_id","job_id","seq");--> statement-breakpoint
CREATE INDEX "ledger_entries_occurred_idx" ON "ledger_entries" USING btree ("organization_id","occurred_at");--> statement-breakpoint
CREATE INDEX "ledger_entries_invoice_idx" ON "ledger_entries" USING btree ("organization_id","invoice_id");--> statement-breakpoint
CREATE UNIQUE INDEX "ledger_entries_external_ref_unique" ON "ledger_entries" USING btree ("organization_id","source","external_ref") WHERE "ledger_entries"."external_ref" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "ledger_entries_reverses_unique" ON "ledger_entries" USING btree ("reverses_id") WHERE "ledger_entries"."reverses_id" is not null;--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- RLS, matching every other org-scoped table in 0001.
--
-- Drizzle connects as a role that bypasses this, so `lib/dal.ts` and the API's
-- `requireOrg` remain the real authorization. These policies are defence in
-- depth against anything arriving through PostgREST, the Supabase client, or a
-- leaked publishable key — and a table without one is a hole.
-- ---------------------------------------------------------------------------

ALTER TABLE "connected_accounts" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint

-- Read-only to the shop. The row is a projection of Stripe's account state,
-- written by `account.updated` and by the onboarding routes over the
-- privileged connection. A shop that could edit `charges_enabled` could give
-- itself a pay button Stripe has not authorized.
CREATE POLICY "connected_accounts: org members read"
  ON public.connected_accounts FOR SELECT TO authenticated
  USING (public.is_org_member(organization_id));--> statement-breakpoint

ALTER TABLE "ledger_entries" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint

CREATE POLICY "ledger_entries: org members read"
  ON public.ledger_entries FOR SELECT TO authenticated
  USING (public.is_org_member(organization_id));--> statement-breakpoint

CREATE POLICY "ledger_entries: org members append"
  ON public.ledger_entries FOR INSERT TO authenticated
  WITH CHECK (public.is_org_member(organization_id));--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- Nothing is ever updated or deleted — Money Ledger §6.
--
-- Enforced at the database rather than by convention, and against the
-- superuser-ish role product code actually connects as rather than only
-- against `authenticated`, because the policies above are invisible to the
-- Drizzle connection. An audit trail you can edit is not an audit trail: an
-- UPDATE here is a silent restatement of somebody's money, and a DELETE is a
-- hole in a ledger that a dispute packet is supposed to close.
--
-- A wrong row is corrected by appending its opposite and pointing at it
-- through `reverses_id` — the standard accounting correction, which leaves
-- both the mistake and the fix in the record.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.ledger_entries_are_append_only()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION
    'ledger_entries is append-only. Correct a row by appending a reversing '
    'entry (see reverseEntry in lib/ledger), never by editing this one.';
END;
$$;--> statement-breakpoint

CREATE TRIGGER ledger_entries_no_update
  BEFORE UPDATE OR DELETE ON public.ledger_entries
  FOR EACH ROW EXECUTE FUNCTION public.ledger_entries_are_append_only();--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- A reversing entry must actually cancel the row it points at.
--
-- The rule is arithmetic, so it belongs where arithmetic cannot be skipped: a
-- reversal carries the same organization, the same job, the same type and the
-- exact negation of the amount. Without this, `reverses_id` is a comment —
-- and a reversal that reverses the wrong amount is worse than no reversal,
-- because it looks settled.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.ledger_entries_reversal_matches()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  original public.ledger_entries%ROWTYPE;
BEGIN
  IF NEW.reverses_id IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT * INTO original
  FROM public.ledger_entries WHERE id = NEW.reverses_id;

  IF original.organization_id <> NEW.organization_id THEN
    RAISE EXCEPTION 'A ledger entry cannot reverse another shop''s entry.';
  END IF;

  IF original.entry_type <> NEW.entry_type THEN
    RAISE EXCEPTION
      'A reversal must carry the same entry_type as the row it reverses (% vs %).',
      NEW.entry_type, original.entry_type;
  END IF;

  IF original.amount_cents <> -NEW.amount_cents THEN
    RAISE EXCEPTION
      'A reversal must negate the row it reverses exactly (% does not cancel %).',
      NEW.amount_cents, original.amount_cents;
  END IF;

  IF original.job_id IS DISTINCT FROM NEW.job_id THEN
    RAISE EXCEPTION
      'A reversal must carry the same job as the row it reverses. '
      'Re-attributing money is a reversal plus a new entry, not one row.';
  END IF;

  RETURN NEW;
END;
$$;--> statement-breakpoint

CREATE TRIGGER ledger_entries_reversal_matches
  BEFORE INSERT ON public.ledger_entries
  FOR EACH ROW EXECUTE FUNCTION public.ledger_entries_reversal_matches();
