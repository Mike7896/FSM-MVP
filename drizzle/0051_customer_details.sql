CREATE TYPE "public"."contact_method" AS ENUM('call', 'text', 'email');--> statement-breakpoint
CREATE TABLE "customer_notes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"customer_id" uuid NOT NULL,
	"body" text NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "customers" ADD COLUMN "first_name" text;--> statement-breakpoint
ALTER TABLE "customers" ADD COLUMN "last_name" text;--> statement-breakpoint
ALTER TABLE "customers" ADD COLUMN "company_name" text;--> statement-breakpoint
ALTER TABLE "customers" ADD COLUMN "alt_email" text;--> statement-breakpoint
ALTER TABLE "customers" ADD COLUMN "alt_phone" text;--> statement-breakpoint
ALTER TABLE "customers" ADD COLUMN "preferred_contact" "contact_method";--> statement-breakpoint
ALTER TABLE "customers" ADD COLUMN "billing_address" text;--> statement-breakpoint
ALTER TABLE "customers" ADD COLUMN "access_notes" text;--> statement-breakpoint
ALTER TABLE "customers" ADD COLUMN "lead_source" text;--> statement-breakpoint
ALTER TABLE "customer_notes" ADD CONSTRAINT "customer_notes_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_notes" ADD CONSTRAINT "customer_notes_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_notes" ADD CONSTRAINT "customer_notes_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "auth"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "customer_notes_customer_idx" ON "customer_notes" USING btree ("customer_id","created_at");--> statement-breakpoint
CREATE INDEX "customer_notes_organization_id_idx" ON "customer_notes" USING btree ("organization_id");--> statement-breakpoint
ALTER TABLE public.customer_notes ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "customer_notes: org members full access" ON public.customer_notes FOR ALL TO authenticated USING (public.is_org_member(organization_id)) WITH CHECK (public.is_org_member(organization_id));
--> statement-breakpoint
-- The single notes field becomes the first entry in each customer's log, dated
-- when the customer was last edited. The column itself is dropped in 0052, so
-- code still reading it keeps working until the deploy that stops.
INSERT INTO public.customer_notes (organization_id, customer_id, body, created_at)
SELECT organization_id, id, btrim(notes), updated_at
FROM public.customers
WHERE notes IS NOT NULL AND btrim(notes) <> '';
