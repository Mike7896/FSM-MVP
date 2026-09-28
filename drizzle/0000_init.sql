-- `auth` and `auth.users` are owned by `supabase_admin` and already exist on a
-- real project, so the DDL drizzle-kit emits for them is neutralised by hand
-- after each generate. See README.md > Database and migrations.
--
-- CREATE SCHEMA IF NOT EXISTS is fine: it short-circuits on the existence
-- check before touching privileges.
CREATE SCHEMA IF NOT EXISTS "auth";
--> statement-breakpoint
CREATE TYPE "public"."billing_trigger" AS ENUM('on_completion', 'on_milestone', 'on_percentage_complete', 'on_schedule_of_values', 'on_recurring_date');--> statement-breakpoint
CREATE TYPE "public"."capture_kind" AS ENUM('note', 'photo', 'measurement', 'audio');--> statement-breakpoint
CREATE TYPE "public"."change_order_status" AS ENUM('draft', 'sent', 'approved', 'declined');--> statement-breakpoint
CREATE TYPE "public"."contract_type" AS ENUM('lump_sum', 'unit_price', 'cost_plus', 'gmp', 'time_and_materials', 'flat_rate_menu');--> statement-breakpoint
CREATE TYPE "public"."estimate_class" AS ENUM('class_5', 'class_4', 'class_3', 'class_2', 'class_1');--> statement-breakpoint
CREATE TYPE "public"."estimating_method" AS ENUM('hourly_judgment', 'labor_units', 'assembly_unit_cost', 'price_book_time', 'parametric', 'analogous', 'production_rate');--> statement-breakpoint
CREATE TYPE "public"."inspection_result" AS ENUM('scheduled', 'passed', 'failed', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."inspection_type" AS ENUM('underground', 'rough_in', 'service', 'final');--> statement-breakpoint
CREATE TYPE "public"."invoice_status" AS ENUM('draft', 'sent', 'viewed', 'paid', 'overdue');--> statement-breakpoint
CREATE TYPE "public"."invoice_type" AS ENUM('deposit', 'draw', 'final_balance');--> statement-breakpoint
CREATE TYPE "public"."job_status" AS ENUM('quoting', 'scheduled', 'in_progress', 'complete', 'paid');--> statement-breakpoint
CREATE TYPE "public"."license_status" AS ENUM('active', 'expiring', 'expired');--> statement-breakpoint
CREATE TYPE "public"."line_item_section" AS ENUM('material', 'labor', 'equipment', 'permit');--> statement-breakpoint
CREATE TYPE "public"."line_item_source" AS ENUM('typed', 'template', 'duplicated', 'price_book', 'ai_drafted');--> statement-breakpoint
CREATE TYPE "public"."member_role" AS ENUM('owner', 'admin', 'dispatcher', 'technician');--> statement-breakpoint
CREATE TYPE "public"."money_up_front" AS ENUM('deposit', 'mobilization', 'none');--> statement-breakpoint
CREATE TYPE "public"."payment_method" AS ENUM('card', 'ach', 'check', 'cash', 'venmo', 'zelle', 'other');--> statement-breakpoint
CREATE TYPE "public"."permit_puller" AS ENUM('shop', 'homeowner', 'subcontractor');--> statement-breakpoint
CREATE TYPE "public"."permit_status" AS ENUM('not_required', 'needed', 'applied', 'issued', 'inspections_in_progress', 'closed', 'expired', 'rejected');--> statement-breakpoint
CREATE TYPE "public"."preset_source" AS ENUM('pack', 'shop');--> statement-breakpoint
CREATE TYPE "public"."price_structure" AS ENUM('single_total', 'itemized', 'partitioned', 'tiered', 'menu', 'two_part');--> statement-breakpoint
CREATE TYPE "public"."pricing_interval" AS ENUM('day', 'week', 'month', 'year');--> statement-breakpoint
CREATE TYPE "public"."pricing_method" AS ENUM('cost_based', 'competition_based', 'value_based');--> statement-breakpoint
CREATE TYPE "public"."progress_billing" AS ENUM('draws', 'progress_billing', 'single_final_invoice');--> statement-breakpoint
CREATE TYPE "public"."quote_status" AS ENUM('draft', 'sent', 'viewed', 'approved', 'declined', 'expired');--> statement-breakpoint
CREATE TYPE "public"."subscription_status" AS ENUM('trialing', 'active', 'incomplete', 'incomplete_expired', 'past_due', 'canceled', 'unpaid', 'paused');--> statement-breakpoint
-- IF NOT EXISTS does NOT work here: Postgres checks CREATE privilege on the
-- schema before the existence check, and the `postgres` role Supabase issues
-- has USAGE but not CREATE on `auth`. Guarding with an explicit existence test
-- means the CREATE never executes on Supabase, while a bare Postgres still
-- gets the stub the foreign keys need.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_tables WHERE schemaname = 'auth' AND tablename = 'users'
  ) THEN
    CREATE TABLE "auth"."users" ("id" uuid PRIMARY KEY NOT NULL);
  END IF;
END $$;
--> statement-breakpoint
CREATE TABLE "customers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"name" text NOT NULL,
	"email" text,
	"phone" text,
	"address" text,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "licenses" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"jurisdiction" text NOT NULL,
	"number" text NOT NULL,
	"class" text,
	"holder" text,
	"issued_on" date,
	"expires_on" date,
	"renewal_reminder_days" integer DEFAULT 60,
	"status" "license_status" DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "memberships" (
	"organization_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"role" "member_role" DEFAULT 'technician' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "memberships_organization_id_user_id_pk" PRIMARY KEY("organization_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "organizations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"phone" text,
	"email" text,
	"logo_url" text,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "organizations_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "pack_enablement" (
	"organization_id" uuid NOT NULL,
	"pack_id" text NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"configuration" jsonb,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pack_enablement_organization_id_pack_id_pk" PRIMARY KEY("organization_id","pack_id")
);
--> statement-breakpoint
CREATE TABLE "pack_entitlements" (
	"organization_id" uuid NOT NULL,
	"pack_id" text NOT NULL,
	"stripe_subscription_item_id" text,
	"granted_at" timestamp with time zone DEFAULT now() NOT NULL,
	"revoked_at" timestamp with time zone,
	CONSTRAINT "pack_entitlements_organization_id_pack_id_pk" PRIMARY KEY("organization_id","pack_id")
);
--> statement-breakpoint
CREATE TABLE "presets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"name" text NOT NULL,
	"source" "preset_source" DEFAULT 'shop' NOT NULL,
	"pack_id" text,
	"estimating_method" "estimating_method",
	"estimate_class" "estimate_class",
	"pricing_method" "pricing_method",
	"price_structure" "price_structure",
	"contract_type" "contract_type",
	"billing_trigger" "billing_trigger",
	"money_up_front" "money_up_front",
	"deposit_percent" integer,
	"progress_billing" "progress_billing",
	"retainage_percent" integer,
	"default_line_items" jsonb,
	"times_used" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "profiles" (
	"id" uuid PRIMARY KEY NOT NULL,
	"email" text NOT NULL,
	"full_name" text,
	"avatar_url" text,
	"phone" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "jobs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"customer_id" uuid NOT NULL,
	"number" integer DEFAULT 0 NOT NULL,
	"name" text,
	"description" text,
	"address" text,
	"jurisdiction" text,
	"status" "job_status" DEFAULT 'quoting' NOT NULL,
	"pack_id" text,
	"starts_on" date,
	"ends_on" date,
	"closed_at" timestamp with time zone,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "change_orders" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"job_id" uuid NOT NULL,
	"parent_contract_id" uuid NOT NULL,
	"number" integer DEFAULT 0 NOT NULL,
	"what_changed" text,
	"price_delta_cents" integer DEFAULT 0 NOT NULL,
	"time_impact_days" integer,
	"status" "change_order_status" DEFAULT 'draft' NOT NULL,
	"sent_at" timestamp with time zone,
	"approved_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "contracts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"job_id" uuid NOT NULL,
	"source_quote_id" uuid,
	"scope_of_work" text,
	"terms" text,
	"agreed_price_cents" integer DEFAULT 0 NOT NULL,
	"contract_type" "contract_type",
	"billing_trigger" "billing_trigger",
	"money_up_front" "money_up_front",
	"deposit_percent" integer,
	"progress_billing" "progress_billing",
	"retainage_percent" integer,
	"license_id" uuid,
	"contractor_signed_at" timestamp with time zone,
	"contractor_signer_name" text,
	"customer_signed_at" timestamp with time zone,
	"customer_signer_name" text,
	"signing_method" text,
	"signer_ip" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "invoices" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"job_id" uuid NOT NULL,
	"source_contract_id" uuid,
	"source_change_order_id" uuid,
	"number" integer DEFAULT 0 NOT NULL,
	"type" "invoice_type" NOT NULL,
	"status" "invoice_status" DEFAULT 'draft' NOT NULL,
	"amount_due_cents" integer DEFAULT 0 NOT NULL,
	"covers" text,
	"issued_at" timestamp with time zone,
	"due_on" date,
	"sent_at" timestamp with time zone,
	"viewed_at" timestamp with time zone,
	"paid_at" timestamp with time zone,
	"voided_at" timestamp with time zone,
	"gate_met" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "line_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"quote_id" uuid,
	"change_order_id" uuid,
	"section" "line_item_section" NOT NULL,
	"description" text NOT NULL,
	"quantity" numeric(12, 3) DEFAULT '1' NOT NULL,
	"unit" text,
	"unit_cost_cents" integer,
	"markup_percent" numeric(7, 3),
	"sell_price_cents" integer DEFAULT 0 NOT NULL,
	"taxable" boolean DEFAULT true NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"source" "line_item_source" DEFAULT 'typed' NOT NULL,
	"pack_detail" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "line_items_one_parent" CHECK (("line_items"."quote_id" is not null)::int + ("line_items"."change_order_id" is not null)::int = 1)
);
--> statement-breakpoint
CREATE TABLE "option_line_items" (
	"option_id" uuid NOT NULL,
	"line_item_id" uuid NOT NULL,
	CONSTRAINT "option_line_items_option_id_line_item_id_pk" PRIMARY KEY("option_id","line_item_id")
);
--> statement-breakpoint
CREATE TABLE "options" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"quote_id" uuid NOT NULL,
	"name" text NOT NULL,
	"summary" text,
	"recommended" boolean DEFAULT false NOT NULL,
	"selected" boolean DEFAULT false NOT NULL,
	"position" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "payments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"job_id" uuid NOT NULL,
	"invoice_id" uuid,
	"amount_cents" integer NOT NULL,
	"method" "payment_method" NOT NULL,
	"paid_on" date NOT NULL,
	"processor_reference" text,
	"recorded_manually" boolean DEFAULT false NOT NULL,
	"refunded_cents" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "quotes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"job_id" uuid NOT NULL,
	"number" integer DEFAULT 0 NOT NULL,
	"title" text,
	"scope_of_work" text,
	"exclusions" text,
	"assumptions" text,
	"commitment_summary" text,
	"terms" text,
	"estimating_method" "estimating_method",
	"estimate_class" "estimate_class",
	"pricing_method" "pricing_method",
	"price_structure" "price_structure",
	"contract_type" "contract_type",
	"billing_trigger" "billing_trigger",
	"money_up_front" "money_up_front",
	"deposit_percent" integer,
	"progress_billing" "progress_billing",
	"retainage_percent" integer,
	"cap_cents" integer,
	"status" "quote_status" DEFAULT 'draft' NOT NULL,
	"tax_rate" numeric(6, 4),
	"preset_id" uuid,
	"license_id" uuid,
	"pack_id" text,
	"valid_until" date,
	"sent_at" timestamp with time zone,
	"viewed_at" timestamp with time zone,
	"responded_at" timestamp with time zone,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "inspections" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"permit_id" uuid NOT NULL,
	"job_id" uuid NOT NULL,
	"type" "inspection_type" NOT NULL,
	"result" "inspection_result" DEFAULT 'scheduled' NOT NULL,
	"requested_on" date,
	"scheduled_on" date,
	"completed_on" date,
	"inspector_notes" text,
	"corrections_required" text,
	"reinspection_fee_cents" integer,
	"clears_phase" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "permits" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"job_id" uuid NOT NULL,
	"jurisdiction" text NOT NULL,
	"type" text,
	"number" text,
	"scope_covered" text,
	"status" "permit_status" DEFAULT 'needed' NOT NULL,
	"pulled_by" "permit_puller" DEFAULT 'shop' NOT NULL,
	"license_id" uuid,
	"fee_paid_cents" integer,
	"fee_line_item_id" uuid,
	"applied_on" date,
	"issued_on" date,
	"expires_on" date,
	"placard_url" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "capture_artifacts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"job_id" uuid NOT NULL,
	"kind" "capture_kind" NOT NULL,
	"body" text,
	"file_url" text,
	"flag" text,
	"location_lat" text,
	"location_lng" text,
	"captured_at" timestamp with time zone DEFAULT now() NOT NULL,
	"captured_by" uuid,
	"used_in_quote" boolean DEFAULT false NOT NULL,
	"promoted_to_evidence_id" uuid
);
--> statement-breakpoint
CREATE TABLE "evidence" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"job_id" uuid NOT NULL,
	"invoice_id" uuid,
	"phase_name" text NOT NULL,
	"summary" text,
	"completed_at" timestamp with time zone,
	"sent_at" timestamp with time zone,
	"approved_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "evidence_photos" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"evidence_id" uuid NOT NULL,
	"file_url" text NOT NULL,
	"caption" text,
	"position" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"job_id" uuid NOT NULL,
	"body" text NOT NULL,
	"sender_user_id" uuid,
	"from_homeowner" boolean DEFAULT false NOT NULL,
	"read_at" timestamp with time zone,
	"sent_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "receipts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"job_id" uuid NOT NULL,
	"vendor" text,
	"amount_cents" integer NOT NULL,
	"description" text,
	"category" text,
	"image_url" text,
	"purchased_on" date,
	"reconciled" boolean DEFAULT false NOT NULL,
	"captured_at" timestamp with time zone DEFAULT now() NOT NULL,
	"captured_by" uuid
);
--> statement-breakpoint
CREATE TABLE "share_links" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"token" text NOT NULL,
	"job_id" uuid NOT NULL,
	"quote_id" uuid,
	"contract_id" uuid,
	"change_order_id" uuid,
	"invoice_id" uuid,
	"scopes" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"expires_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	"last_accessed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "share_links_token_unique" UNIQUE("token"),
	CONSTRAINT "share_links_one_target" CHECK (("share_links"."quote_id" is not null)::int
        + ("share_links"."contract_id" is not null)::int
        + ("share_links"."change_order_id" is not null)::int
        + ("share_links"."invoice_id" is not null)::int = 1)
);
--> statement-breakpoint
CREATE TABLE "prices" (
	"id" text PRIMARY KEY NOT NULL,
	"product_id" text,
	"active" boolean DEFAULT true NOT NULL,
	"currency" text NOT NULL,
	"unit_amount" integer,
	"interval" "pricing_interval",
	"interval_count" integer,
	"trial_period_days" integer,
	"metadata" jsonb
);
--> statement-breakpoint
CREATE TABLE "products" (
	"id" text PRIMARY KEY NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"image" text,
	"metadata" jsonb
);
--> statement-breakpoint
CREATE TABLE "stripe_customers" (
	"organization_id" uuid PRIMARY KEY NOT NULL,
	"stripe_customer_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "stripe_customers_stripe_customer_id_unique" UNIQUE("stripe_customer_id")
);
--> statement-breakpoint
CREATE TABLE "stripe_events" (
	"id" text PRIMARY KEY NOT NULL,
	"type" text NOT NULL,
	"processed_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "subscriptions" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"status" "subscription_status" NOT NULL,
	"price_id" text,
	"quantity" integer,
	"cancel_at_period_end" boolean DEFAULT false NOT NULL,
	"current_period_start" timestamp with time zone,
	"current_period_end" timestamp with time zone,
	"cancel_at" timestamp with time zone,
	"canceled_at" timestamp with time zone,
	"ended_at" timestamp with time zone,
	"trial_start" timestamp with time zone,
	"trial_end" timestamp with time zone,
	"metadata" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "customers" ADD CONSTRAINT "customers_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "licenses" ADD CONSTRAINT "licenses_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "organizations" ADD CONSTRAINT "organizations_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "auth"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pack_enablement" ADD CONSTRAINT "pack_enablement_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pack_entitlements" ADD CONSTRAINT "pack_entitlements_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "presets" ADD CONSTRAINT "presets_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "profiles" ADD CONSTRAINT "profiles_id_users_id_fk" FOREIGN KEY ("id") REFERENCES "auth"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "jobs" ADD CONSTRAINT "jobs_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "jobs" ADD CONSTRAINT "jobs_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "jobs" ADD CONSTRAINT "jobs_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "auth"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "change_orders" ADD CONSTRAINT "change_orders_job_id_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."jobs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "change_orders" ADD CONSTRAINT "change_orders_parent_contract_id_contracts_id_fk" FOREIGN KEY ("parent_contract_id") REFERENCES "public"."contracts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contracts" ADD CONSTRAINT "contracts_job_id_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."jobs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contracts" ADD CONSTRAINT "contracts_source_quote_id_quotes_id_fk" FOREIGN KEY ("source_quote_id") REFERENCES "public"."quotes"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contracts" ADD CONSTRAINT "contracts_license_id_licenses_id_fk" FOREIGN KEY ("license_id") REFERENCES "public"."licenses"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_job_id_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."jobs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_source_contract_id_contracts_id_fk" FOREIGN KEY ("source_contract_id") REFERENCES "public"."contracts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_source_change_order_id_change_orders_id_fk" FOREIGN KEY ("source_change_order_id") REFERENCES "public"."change_orders"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "line_items" ADD CONSTRAINT "line_items_quote_id_quotes_id_fk" FOREIGN KEY ("quote_id") REFERENCES "public"."quotes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "line_items" ADD CONSTRAINT "line_items_change_order_id_change_orders_id_fk" FOREIGN KEY ("change_order_id") REFERENCES "public"."change_orders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "option_line_items" ADD CONSTRAINT "option_line_items_option_id_options_id_fk" FOREIGN KEY ("option_id") REFERENCES "public"."options"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "option_line_items" ADD CONSTRAINT "option_line_items_line_item_id_line_items_id_fk" FOREIGN KEY ("line_item_id") REFERENCES "public"."line_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "options" ADD CONSTRAINT "options_quote_id_quotes_id_fk" FOREIGN KEY ("quote_id") REFERENCES "public"."quotes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_job_id_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."jobs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_invoice_id_invoices_id_fk" FOREIGN KEY ("invoice_id") REFERENCES "public"."invoices"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quotes" ADD CONSTRAINT "quotes_job_id_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."jobs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quotes" ADD CONSTRAINT "quotes_preset_id_presets_id_fk" FOREIGN KEY ("preset_id") REFERENCES "public"."presets"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quotes" ADD CONSTRAINT "quotes_license_id_licenses_id_fk" FOREIGN KEY ("license_id") REFERENCES "public"."licenses"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quotes" ADD CONSTRAINT "quotes_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "auth"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inspections" ADD CONSTRAINT "inspections_permit_id_permits_id_fk" FOREIGN KEY ("permit_id") REFERENCES "public"."permits"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inspections" ADD CONSTRAINT "inspections_job_id_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."jobs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "permits" ADD CONSTRAINT "permits_job_id_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."jobs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "permits" ADD CONSTRAINT "permits_license_id_licenses_id_fk" FOREIGN KEY ("license_id") REFERENCES "public"."licenses"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "permits" ADD CONSTRAINT "permits_fee_line_item_id_line_items_id_fk" FOREIGN KEY ("fee_line_item_id") REFERENCES "public"."line_items"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "capture_artifacts" ADD CONSTRAINT "capture_artifacts_job_id_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."jobs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "capture_artifacts" ADD CONSTRAINT "capture_artifacts_captured_by_users_id_fk" FOREIGN KEY ("captured_by") REFERENCES "auth"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "evidence" ADD CONSTRAINT "evidence_job_id_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."jobs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "evidence" ADD CONSTRAINT "evidence_invoice_id_invoices_id_fk" FOREIGN KEY ("invoice_id") REFERENCES "public"."invoices"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "evidence_photos" ADD CONSTRAINT "evidence_photos_evidence_id_evidence_id_fk" FOREIGN KEY ("evidence_id") REFERENCES "public"."evidence"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_job_id_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."jobs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_sender_user_id_users_id_fk" FOREIGN KEY ("sender_user_id") REFERENCES "auth"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "receipts" ADD CONSTRAINT "receipts_job_id_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."jobs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "receipts" ADD CONSTRAINT "receipts_captured_by_users_id_fk" FOREIGN KEY ("captured_by") REFERENCES "auth"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "share_links" ADD CONSTRAINT "share_links_job_id_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."jobs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "share_links" ADD CONSTRAINT "share_links_quote_id_quotes_id_fk" FOREIGN KEY ("quote_id") REFERENCES "public"."quotes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "share_links" ADD CONSTRAINT "share_links_contract_id_contracts_id_fk" FOREIGN KEY ("contract_id") REFERENCES "public"."contracts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "share_links" ADD CONSTRAINT "share_links_change_order_id_change_orders_id_fk" FOREIGN KEY ("change_order_id") REFERENCES "public"."change_orders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "share_links" ADD CONSTRAINT "share_links_invoice_id_invoices_id_fk" FOREIGN KEY ("invoice_id") REFERENCES "public"."invoices"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prices" ADD CONSTRAINT "prices_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stripe_customers" ADD CONSTRAINT "stripe_customers_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_price_id_prices_id_fk" FOREIGN KEY ("price_id") REFERENCES "public"."prices"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "customers_organization_id_idx" ON "customers" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "licenses_organization_id_idx" ON "licenses" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "licenses_jurisdiction_idx" ON "licenses" USING btree ("organization_id","jurisdiction");--> statement-breakpoint
CREATE INDEX "memberships_user_id_idx" ON "memberships" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "organizations_created_by_idx" ON "organizations" USING btree ("created_by");--> statement-breakpoint
CREATE UNIQUE INDEX "pack_enablement_org_pack_idx" ON "pack_enablement" USING btree ("organization_id","pack_id");--> statement-breakpoint
CREATE INDEX "presets_organization_id_idx" ON "presets" USING btree ("organization_id");--> statement-breakpoint
CREATE UNIQUE INDEX "jobs_org_number_unique" ON "jobs" USING btree ("organization_id","number");--> statement-breakpoint
CREATE INDEX "jobs_organization_id_idx" ON "jobs" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "jobs_customer_id_idx" ON "jobs" USING btree ("customer_id");--> statement-breakpoint
CREATE INDEX "jobs_status_idx" ON "jobs" USING btree ("organization_id","status");--> statement-breakpoint
CREATE INDEX "jobs_starts_on_idx" ON "jobs" USING btree ("organization_id","starts_on");--> statement-breakpoint
CREATE INDEX "change_orders_job_id_idx" ON "change_orders" USING btree ("job_id");--> statement-breakpoint
CREATE INDEX "change_orders_contract_id_idx" ON "change_orders" USING btree ("parent_contract_id");--> statement-breakpoint
CREATE INDEX "contracts_job_id_idx" ON "contracts" USING btree ("job_id");--> statement-breakpoint
CREATE UNIQUE INDEX "contracts_job_unique" ON "contracts" USING btree ("job_id");--> statement-breakpoint
CREATE INDEX "invoices_job_id_idx" ON "invoices" USING btree ("job_id");--> statement-breakpoint
CREATE INDEX "invoices_status_idx" ON "invoices" USING btree ("status");--> statement-breakpoint
CREATE INDEX "line_items_quote_id_idx" ON "line_items" USING btree ("quote_id");--> statement-breakpoint
CREATE INDEX "line_items_change_order_id_idx" ON "line_items" USING btree ("change_order_id");--> statement-breakpoint
CREATE INDEX "options_quote_id_idx" ON "options" USING btree ("quote_id");--> statement-breakpoint
CREATE INDEX "payments_job_id_idx" ON "payments" USING btree ("job_id");--> statement-breakpoint
CREATE INDEX "payments_invoice_id_idx" ON "payments" USING btree ("invoice_id");--> statement-breakpoint
CREATE INDEX "quotes_job_id_idx" ON "quotes" USING btree ("job_id");--> statement-breakpoint
CREATE INDEX "quotes_status_idx" ON "quotes" USING btree ("status");--> statement-breakpoint
CREATE INDEX "inspections_permit_id_idx" ON "inspections" USING btree ("permit_id");--> statement-breakpoint
CREATE INDEX "inspections_job_id_idx" ON "inspections" USING btree ("job_id");--> statement-breakpoint
CREATE INDEX "permits_job_id_idx" ON "permits" USING btree ("job_id");--> statement-breakpoint
CREATE INDEX "permits_status_idx" ON "permits" USING btree ("status");--> statement-breakpoint
CREATE INDEX "capture_artifacts_job_id_idx" ON "capture_artifacts" USING btree ("job_id");--> statement-breakpoint
CREATE INDEX "evidence_job_id_idx" ON "evidence" USING btree ("job_id");--> statement-breakpoint
CREATE INDEX "evidence_invoice_id_idx" ON "evidence" USING btree ("invoice_id");--> statement-breakpoint
CREATE INDEX "evidence_photos_evidence_id_idx" ON "evidence_photos" USING btree ("evidence_id");--> statement-breakpoint
CREATE INDEX "messages_job_id_idx" ON "messages" USING btree ("job_id");--> statement-breakpoint
CREATE INDEX "receipts_job_id_idx" ON "receipts" USING btree ("job_id");--> statement-breakpoint
CREATE INDEX "share_links_job_id_idx" ON "share_links" USING btree ("job_id");--> statement-breakpoint
CREATE INDEX "prices_product_id_idx" ON "prices" USING btree ("product_id");--> statement-breakpoint
CREATE INDEX "stripe_customers_customer_id_idx" ON "stripe_customers" USING btree ("stripe_customer_id");--> statement-breakpoint
CREATE INDEX "subscriptions_organization_id_idx" ON "subscriptions" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "subscriptions_status_idx" ON "subscriptions" USING btree ("status");