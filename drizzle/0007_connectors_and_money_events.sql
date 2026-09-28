CREATE TYPE "public"."connection_kind" AS ENUM('accounting', 'bank', 'processor', 'mail');--> statement-breakpoint
CREATE TYPE "public"."connection_provider" AS ENUM('quickbooks', 'plaid', 'square', 'stripe_connect', 'paypal', 'google_mail');--> statement-breakpoint
CREATE TYPE "public"."connection_status" AS ENUM('connected', 'needs_reauth', 'degraded', 'error', 'revoked');--> statement-breakpoint
CREATE TYPE "public"."money_event_type" AS ENUM('deposit_collected', 'milestone_billed', 'payment_received', 'refund_issued', 'change_order_applied');--> statement-breakpoint
CREATE TYPE "public"."sync_job_status" AS ENUM('pending', 'in_flight', 'succeeded', 'failed', 'dead');--> statement-breakpoint
CREATE TABLE "connection_secrets" (
	"connection_id" uuid PRIMARY KEY NOT NULL,
	"access_token" text NOT NULL,
	"refresh_token" text,
	"access_token_expires_at" timestamp with time zone,
	"refresh_token_expires_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "connections" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"kind" "connection_kind" NOT NULL,
	"provider" "connection_provider" NOT NULL,
	"status" "connection_status" DEFAULT 'connected' NOT NULL,
	"external_account_id" text,
	"external_account_name" text,
	"scopes" text[],
	"connected_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_healthy_at" timestamp with time zone,
	"last_error" text,
	"last_error_at" timestamp with time zone,
	"settings" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "external_refs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"provider" "connection_provider" NOT NULL,
	"entity" text NOT NULL,
	"local_id" text NOT NULL,
	"remote_id" text NOT NULL,
	"remote_version" text,
	"last_pushed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "oauth_states" (
	"state" text PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"provider" "connection_provider" NOT NULL,
	"user_id" uuid NOT NULL,
	"code_verifier" text,
	"return_to" text,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sync_jobs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"provider" "connection_provider" NOT NULL,
	"operation" text NOT NULL,
	"entity" text NOT NULL,
	"local_id" text NOT NULL,
	"idempotency_key" text NOT NULL,
	"payload" jsonb,
	"status" "sync_job_status" DEFAULT 'pending' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"next_attempt_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_error" text,
	"remote_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "money_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"job_id" uuid NOT NULL,
	"type" "money_event_type" NOT NULL,
	"amount_cents" integer NOT NULL,
	"currency" text DEFAULT 'usd' NOT NULL,
	"occurred_at" timestamp with time zone NOT NULL,
	"invoice_id" uuid,
	"payment_id" uuid,
	"change_order_id" uuid,
	"method" text,
	"source" text DEFAULT 'manual' NOT NULL,
	"dedupe_key" text NOT NULL,
	"detail" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "connection_secrets" ADD CONSTRAINT "connection_secrets_connection_id_connections_id_fk" FOREIGN KEY ("connection_id") REFERENCES "public"."connections"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "connections" ADD CONSTRAINT "connections_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "external_refs" ADD CONSTRAINT "external_refs_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "oauth_states" ADD CONSTRAINT "oauth_states_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sync_jobs" ADD CONSTRAINT "sync_jobs_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "money_events" ADD CONSTRAINT "money_events_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "money_events" ADD CONSTRAINT "money_events_job_id_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."jobs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "money_events" ADD CONSTRAINT "money_events_invoice_id_invoices_id_fk" FOREIGN KEY ("invoice_id") REFERENCES "public"."invoices"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "money_events" ADD CONSTRAINT "money_events_payment_id_payments_id_fk" FOREIGN KEY ("payment_id") REFERENCES "public"."payments"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "money_events" ADD CONSTRAINT "money_events_change_order_id_change_orders_id_fk" FOREIGN KEY ("change_order_id") REFERENCES "public"."change_orders"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "connections_organization_id_idx" ON "connections" USING btree ("organization_id");--> statement-breakpoint
CREATE UNIQUE INDEX "connections_org_provider_unique" ON "connections" USING btree ("organization_id","provider");--> statement-breakpoint
CREATE UNIQUE INDEX "external_refs_local_unique" ON "external_refs" USING btree ("organization_id","provider","entity","local_id");--> statement-breakpoint
CREATE INDEX "external_refs_remote_idx" ON "external_refs" USING btree ("organization_id","provider","entity","remote_id");--> statement-breakpoint
CREATE INDEX "oauth_states_expires_at_idx" ON "oauth_states" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "sync_jobs_due_idx" ON "sync_jobs" USING btree ("status","next_attempt_at");--> statement-breakpoint
CREATE INDEX "sync_jobs_organization_id_idx" ON "sync_jobs" USING btree ("organization_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "sync_jobs_idempotency_unique" ON "sync_jobs" USING btree ("organization_id","provider","idempotency_key");--> statement-breakpoint
CREATE INDEX "money_events_job_id_idx" ON "money_events" USING btree ("job_id","occurred_at");--> statement-breakpoint
CREATE INDEX "money_events_org_occurred_idx" ON "money_events" USING btree ("organization_id","occurred_at");--> statement-breakpoint
CREATE INDEX "money_events_type_idx" ON "money_events" USING btree ("organization_id","type");--> statement-breakpoint
CREATE UNIQUE INDEX "money_events_dedupe_unique" ON "money_events" USING btree ("organization_id","dedupe_key");--> statement-breakpoint

-- RLS, matching every other org-scoped table in 0001. Drizzle connects as a
-- role that bypasses this, so the DAL and the API's `requireOrg` remain the
-- real authorization — but a table without a policy is a hole for anything
-- arriving through PostgREST or the Supabase client.
ALTER TABLE "connections" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "connections: org members full access"
  ON public.connections FOR ALL TO authenticated
  USING (public.is_org_member(organization_id))
  WITH CHECK (public.is_org_member(organization_id));--> statement-breakpoint

-- `connection_secrets` gets NO policy on purpose.
--
-- RLS with row-level security enabled and no policy denies everything, which
-- is exactly right here: nothing reaching Postgres as an end user has any
-- business reading another company's QuickBooks refresh token, and the only
-- legitimate reader is `lib/connectors/store` on the server, over the Drizzle
-- connection that bypasses RLS. A policy here would be a way in that does not
-- need to exist.
ALTER TABLE "connection_secrets" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint

-- Same reasoning: an in-flight OAuth state is a CSRF defence, and a defence
-- readable by the thing it defends against is not one.
ALTER TABLE "oauth_states" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint

ALTER TABLE "external_refs" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "external_refs: org members full access"
  ON public.external_refs FOR ALL TO authenticated
  USING (public.is_org_member(organization_id))
  WITH CHECK (public.is_org_member(organization_id));--> statement-breakpoint

ALTER TABLE "sync_jobs" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "sync_jobs: org members full access"
  ON public.sync_jobs FOR ALL TO authenticated
  USING (public.is_org_member(organization_id))
  WITH CHECK (public.is_org_member(organization_id));--> statement-breakpoint

-- The money log is readable by the org and **append-only for everyone**.
--
-- An audit trail you can edit is not an audit trail. The accounting sync
-- replays from these rows, so an UPDATE here is a silent restatement of what
-- was posted to somebody's books, and a DELETE is a hole in a ledger. A
-- mistake is corrected by a later event — a refund, a credit — the same way a
-- ledger is corrected in double-entry bookkeeping.
ALTER TABLE "money_events" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "money_events: org members read"
  ON public.money_events FOR SELECT TO authenticated
  USING (public.is_org_member(organization_id));--> statement-breakpoint
CREATE POLICY "money_events: org members append"
  ON public.money_events FOR INSERT TO authenticated
  WITH CHECK (public.is_org_member(organization_id));--> statement-breakpoint

-- Belt to that policy's braces: the append-only rule holds against the role
-- that bypasses RLS too, which is the one product code actually connects as.
CREATE OR REPLACE FUNCTION public.money_events_are_append_only()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION
    'money_events is append-only. Correct a mistake with a later event.';
END;
$$;--> statement-breakpoint

CREATE TRIGGER money_events_no_update
  BEFORE UPDATE OR DELETE ON public.money_events
  FOR EACH ROW EXECUTE FUNCTION public.money_events_are_append_only();
