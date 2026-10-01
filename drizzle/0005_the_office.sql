CREATE TABLE "assemblies" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"name" text NOT NULL,
	"source" "preset_source" DEFAULT 'shop' NOT NULL,
	"pack_id" text,
	"unit" text,
	"times_used" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "assembly_components" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"assembly_id" uuid NOT NULL,
	"description" text NOT NULL,
	"section" "line_item_section" NOT NULL,
	"quantity" numeric(12, 3) DEFAULT '1' NOT NULL,
	"unit" text,
	"unit_cost_cents" integer,
	"markup_percent" numeric(7, 3),
	"position" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
ALTER TABLE "organizations" ADD COLUMN "address" text;--> statement-breakpoint
ALTER TABLE "organizations" ADD COLUMN "website" text;--> statement-breakpoint
ALTER TABLE "shop_defaults" ADD COLUMN "draw_pattern" jsonb;--> statement-breakpoint
ALTER TABLE "shop_defaults" ADD COLUMN "standard_terms" text;--> statement-breakpoint
ALTER TABLE "assemblies" ADD CONSTRAINT "assemblies_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assembly_components" ADD CONSTRAINT "assembly_components_assembly_id_assemblies_id_fk" FOREIGN KEY ("assembly_id") REFERENCES "public"."assemblies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "assemblies_organization_id_idx" ON "assemblies" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "assembly_components_assembly_id_idx" ON "assembly_components" USING btree ("assembly_id");--> statement-breakpoint
-- RLS on the two new Office tables, matching every other org-scoped table in
-- 0001. Drizzle connects as a role that bypasses this, so the DAL and the API's
-- `requireOrg` remain the real authorization — but a table left without a
-- policy is a hole for anything arriving through PostgREST or the Supabase
-- client.
ALTER TABLE "assemblies" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "assemblies: org members full access"
  ON public.assemblies FOR ALL TO authenticated
  USING (public.is_org_member(organization_id))
  WITH CHECK (public.is_org_member(organization_id));--> statement-breakpoint

-- A component has no organization of its own — it reaches one through the
-- assembly that owns it, the same way a line item reaches one through its
-- quote. The membership check therefore has to join rather than read a column.
ALTER TABLE "assembly_components" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "assembly_components: org members full access"
  ON public.assembly_components FOR ALL TO authenticated
  USING (
    exists (
      select 1 from public.assemblies a
      where a.id = assembly_id and public.is_org_member(a.organization_id)
    )
  )
  WITH CHECK (
    exists (
      select 1 from public.assemblies a
      where a.id = assembly_id and public.is_org_member(a.organization_id)
    )
  );--> statement-breakpoint

-- THE OFFICE, not the shop. Content Design §5.1 reserves *Shop* for the
-- physical location object that arrives at team tier — a stock of material, a
-- crew, a service area — and a contractor who grows runs several. The business
-- itself is the Office, so the table that holds its document and money defaults
-- takes that name before a real `shops` table exists to be confused with it.
--
-- A rename rather than a create-and-copy: the rows are the same rows, and every
-- policy, index and foreign key on them follows the table across.
ALTER TABLE "shop_defaults" RENAME TO "office_defaults";--> statement-breakpoint
ALTER POLICY "shop_defaults: org members full access"
  ON public.office_defaults RENAME TO "office_defaults: org members full access";--> statement-breakpoint

-- Postgres does not rename a table's constraints when the table is renamed, so
-- they are renamed here too. Leaving them behind would mean a later migration
-- that drops one by name looks for a constraint whose name says `shop`.
ALTER TABLE "office_defaults"
  RENAME CONSTRAINT "shop_defaults_organization_id_organizations_id_fk"
  TO "office_defaults_organization_id_organizations_id_fk";--> statement-breakpoint
ALTER TABLE "office_defaults"
  RENAME CONSTRAINT "shop_defaults_default_preset_id_presets_id_fk"
  TO "office_defaults_default_preset_id_presets_id_fk";--> statement-breakpoint
ALTER TABLE "office_defaults"
  RENAME CONSTRAINT "shop_defaults_pkey" TO "office_defaults_pkey";
