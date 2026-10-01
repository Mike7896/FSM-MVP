CREATE TABLE "shop_defaults" (
	"organization_id" uuid PRIMARY KEY NOT NULL,
	"deposit_percent" integer,
	"material_markup_percent" numeric(7, 3),
	"labor_rate_cents" integer,
	"tax_rate" numeric(6, 4),
	"quote_validity_days" integer DEFAULT 30,
	"standard_exclusions" text,
	"standard_assumptions" text,
	"document_preset" text DEFAULT 'classic',
	"default_preset_id" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "shop_defaults" ADD CONSTRAINT "shop_defaults_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shop_defaults" ADD CONSTRAINT "shop_defaults_default_preset_id_presets_id_fk" FOREIGN KEY ("default_preset_id") REFERENCES "public"."presets"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
-- RLS, matching every other org-scoped table in 0001. Drizzle connects as a
-- role that bypasses this, so the DAL and the API's `requireOrg` remain the
-- real authorization — but a table left without a policy is a hole for
-- anything arriving through PostgREST or the Supabase client.
ALTER TABLE "shop_defaults" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "shop_defaults: org members full access"
  ON public.shop_defaults FOR ALL TO authenticated
  USING (public.is_org_member(organization_id))
  WITH CHECK (public.is_org_member(organization_id));
