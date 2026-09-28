-- The membership: what a shop pays ServiceClerk, what that buys, and what it
-- has used. Launch Billing Specification §11.2.
--
-- Additive only. Nothing existing changes shape except two new columns:
-- `prices.lookup_key` (how the app names a Stripe price across environments)
-- and `support_requests.priority` (Pro's prioritized queue).
--
-- Every table is read and written by the server through Drizzle, which
-- bypasses RLS. RLS is enabled with member-read policies as defence in depth,
-- the same as the rest of the schema; nothing here is writable from the
-- browser.

ALTER TABLE "prices" ADD COLUMN IF NOT EXISTS "lookup_key" text;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "prices_lookup_key_idx" ON "prices" USING btree ("lookup_key");--> statement-breakpoint
ALTER TABLE "support_requests" ADD COLUMN IF NOT EXISTS "priority" boolean DEFAULT false NOT NULL;--> statement-breakpoint

CREATE TABLE "billing_accounts" (
	"organization_id" uuid PRIMARY KEY NOT NULL,
	"subscription_id" text,
	"subscription_status" text,
	"tier" text DEFAULT 'free' NOT NULL,
	"interval" text,
	"packs" text[] DEFAULT '{}'::text[] NOT NULL,
	"price_keys" text[] DEFAULT '{}'::text[] NOT NULL,
	"founding_price" boolean DEFAULT false NOT NULL,
	"current_period_start" timestamp with time zone,
	"current_period_end" timestamp with time zone,
	"paid_through" timestamp with time zone,
	"past_due_since" timestamp with time zone,
	"unpaid_invoice_id" text,
	"cancel_at_period_end" boolean DEFAULT false NOT NULL,
	"ended_at" timestamp with time zone,
	"pending_change" jsonb,
	"scheduled_change" jsonb,
	"schedule_id" text,
	"first_paid_at" timestamp with time zone,
	"refunded_at" timestamp with time zone,
	"paid_access_ended_at" timestamp with time zone,
	"founding_status" text DEFAULT 'none' NOT NULL,
	"founding_hold_until" timestamp with time zone,
	"founding_hold_session" text,
	"founding_enrolled_at" timestamp with time zone,
	"notices" text[] DEFAULT '{}'::text[] NOT NULL,
	"reconciled_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "billing_accounts_tier_check" CHECK ("billing_accounts"."tier" in ('free', 'starter', 'pro'))
);--> statement-breakpoint
ALTER TABLE "billing_accounts" ADD CONSTRAINT "billing_accounts_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "billing_accounts_subscription_idx" ON "billing_accounts" USING btree ("subscription_id") WHERE "billing_accounts"."subscription_id" is not null;--> statement-breakpoint
CREATE INDEX "billing_accounts_founding_idx" ON "billing_accounts" USING btree ("founding_status");--> statement-breakpoint

CREATE TABLE "pack_evaluations" (
	"organization_id" uuid NOT NULL,
	"pack_id" text NOT NULL,
	"started_at" timestamp with time zone NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"ended_at" timestamp with time zone,
	"started_by" uuid,
	"owner_email" text,
	CONSTRAINT "pack_evaluations_organization_id_pack_id_pk" PRIMARY KEY("organization_id","pack_id")
);--> statement-breakpoint
ALTER TABLE "pack_evaluations" ADD CONSTRAINT "pack_evaluations_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "pack_evaluations_owner_idx" ON "pack_evaluations" USING btree ("pack_id","owner_email");--> statement-breakpoint

CREATE TABLE "job_activations" (
	"job_id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"period" text NOT NULL,
	"status" text NOT NULL,
	"action" text NOT NULL,
	"token" uuid NOT NULL,
	"reserved_at" timestamp with time zone NOT NULL,
	"committed_at" timestamp with time zone,
	"actor_user_id" uuid,
	CONSTRAINT "job_activations_status_check" CHECK ("status" in ('reserved', 'committed'))
);--> statement-breakpoint
ALTER TABLE "job_activations" ADD CONSTRAINT "job_activations_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "job_activations_period_idx" ON "job_activations" USING btree ("organization_id","period");--> statement-breakpoint

CREATE TABLE "billing_releases" (
	"key" text PRIMARY KEY NOT NULL,
	"enabled" boolean DEFAULT false NOT NULL,
	"config" jsonb,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid
);--> statement-breakpoint

CREATE TABLE "billing_events" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"organization_id" uuid,
	"actor_user_id" uuid,
	"kind" text NOT NULL,
	"detail" jsonb,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
ALTER TABLE "billing_events" ADD CONSTRAINT "billing_events_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "billing_events_org_idx" ON "billing_events" USING btree ("organization_id","occurred_at");--> statement-breakpoint

CREATE TABLE "ai_credit_entries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"lot_id" uuid,
	"credits" integer NOT NULL,
	"operation_id" text,
	"window_key" text,
	"source_ref" text,
	"unit_price_micros" integer,
	"expires_at" timestamp with time zone,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
ALTER TABLE "ai_credit_entries" ADD CONSTRAINT "ai_credit_entries_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ai_credit_entries_org_idx" ON "ai_credit_entries" USING btree ("organization_id","created_at");--> statement-breakpoint
CREATE INDEX "ai_credit_entries_lot_idx" ON "ai_credit_entries" USING btree ("lot_id");--> statement-breakpoint
CREATE UNIQUE INDEX "ai_credit_entries_grant_unique" ON "ai_credit_entries" USING btree ("organization_id","window_key") WHERE "ai_credit_entries"."kind" = 'grant';--> statement-breakpoint
CREATE UNIQUE INDEX "ai_credit_entries_purchase_unique" ON "ai_credit_entries" USING btree ("source_ref") WHERE "ai_credit_entries"."kind" = 'purchase';--> statement-breakpoint
CREATE UNIQUE INDEX "ai_credit_entries_movement_unique" ON "ai_credit_entries" USING btree ("lot_id","operation_id","kind") WHERE "ai_credit_entries"."operation_id" is not null;--> statement-breakpoint

CREATE TABLE "payment_attempts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"invoice_id" uuid NOT NULL,
	"stripe_account_id" text NOT NULL,
	"payment_intent_id" text,
	"rail" text NOT NULL,
	"amount_cents" integer NOT NULL,
	"application_fee_cents" integer DEFAULT 0 NOT NULL,
	"status" text DEFAULT 'awaiting' NOT NULL,
	"refunded_cents" integer DEFAULT 0 NOT NULL,
	"fee_refunded_cents" integer DEFAULT 0 NOT NULL,
	"idempotency_key" text NOT NULL,
	"failure_message" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "payment_attempts_payment_intent_id_unique" UNIQUE("payment_intent_id"),
	CONSTRAINT "payment_attempts_idempotency_key_unique" UNIQUE("idempotency_key"),
	CONSTRAINT "payment_attempts_rail_check" CHECK ("payment_attempts"."rail" in ('card', 'ach'))
);--> statement-breakpoint
ALTER TABLE "payment_attempts" ADD CONSTRAINT "payment_attempts_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_attempts" ADD CONSTRAINT "payment_attempts_invoice_id_documents_id_fk" FOREIGN KEY ("invoice_id") REFERENCES "public"."documents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "payment_attempts_invoice_idx" ON "payment_attempts" USING btree ("invoice_id","status");--> statement-breakpoint

-- Defence in depth: members read their own shop's rows; nothing is writable
-- from the browser. Releases are platform-wide and admin-only.
alter table public.billing_accounts enable row level security;--> statement-breakpoint
create policy "billing_accounts: members read"
  on public.billing_accounts for select to authenticated
  using (public.is_org_member(organization_id));--> statement-breakpoint
alter table public.pack_evaluations enable row level security;--> statement-breakpoint
create policy "pack_evaluations: members read"
  on public.pack_evaluations for select to authenticated
  using (public.is_org_member(organization_id));--> statement-breakpoint
alter table public.job_activations enable row level security;--> statement-breakpoint
create policy "job_activations: members read"
  on public.job_activations for select to authenticated
  using (public.is_org_member(organization_id));--> statement-breakpoint
alter table public.billing_events enable row level security;--> statement-breakpoint
create policy "billing_events: members read"
  on public.billing_events for select to authenticated
  using (public.is_org_member(organization_id));--> statement-breakpoint
alter table public.ai_credit_entries enable row level security;--> statement-breakpoint
create policy "ai_credit_entries: members read"
  on public.ai_credit_entries for select to authenticated
  using (public.is_org_member(organization_id));--> statement-breakpoint
alter table public.payment_attempts enable row level security;--> statement-breakpoint
create policy "payment_attempts: members read"
  on public.payment_attempts for select to authenticated
  using (public.is_org_member(organization_id));--> statement-breakpoint
alter table public.billing_releases enable row level security;--> statement-breakpoint
create policy "billing_releases: admins read"
  on public.billing_releases for select to authenticated
  using (public.is_platform_admin());
