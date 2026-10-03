CREATE TABLE "job_item_settings" (
	"job_id" uuid NOT NULL,
	"saved_item_id" uuid NOT NULL,
	"organization_id" uuid NOT NULL,
	"values" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "job_item_settings_job_id_saved_item_id_pk" PRIMARY KEY("job_id","saved_item_id")
);
--> statement-breakpoint
CREATE TABLE "saved_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"name" text NOT NULL,
	"template" jsonb NOT NULL,
	"settings" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"defaults" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"summary" text,
	"image_url" text,
	"source" "preset_source" DEFAULT 'shop' NOT NULL,
	"pack_id" text,
	"times_used" integer DEFAULT 0 NOT NULL,
	"last_used_at" timestamp with time zone,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "job_item_settings" ADD CONSTRAINT "job_item_settings_job_id_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."jobs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "job_item_settings" ADD CONSTRAINT "job_item_settings_saved_item_id_saved_items_id_fk" FOREIGN KEY ("saved_item_id") REFERENCES "public"."saved_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "job_item_settings" ADD CONSTRAINT "job_item_settings_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "saved_items" ADD CONSTRAINT "saved_items_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "saved_items" ADD CONSTRAINT "saved_items_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "auth"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "job_item_settings_organization_id_idx" ON "job_item_settings" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "saved_items_organization_id_idx" ON "saved_items" USING btree ("organization_id");--> statement-breakpoint
ALTER TABLE "saved_items" ADD CONSTRAINT "saved_items_name_check" CHECK (length(btrim(name)) BETWEEN 1 AND 120);
--> statement-breakpoint
-- A job's settings must point at a job and a saved item of the same Office, even for writes outside the API.
CREATE FUNCTION public.job_item_settings_guard() RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
 IF NOT EXISTS (SELECT 1 FROM jobs WHERE id = NEW.job_id AND organization_id = NEW.organization_id)
 OR NOT EXISTS (SELECT 1 FROM saved_items WHERE id = NEW.saved_item_id AND organization_id = NEW.organization_id) THEN
 RAISE EXCEPTION 'The job and the saved item must belong to the same organization.' USING ERRCODE = '23514';
 END IF;
 RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER job_item_settings_guard BEFORE INSERT OR UPDATE ON job_item_settings FOR EACH ROW EXECUTE FUNCTION public.job_item_settings_guard();
--> statement-breakpoint
ALTER TABLE public.saved_items ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE public.job_item_settings ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "saved_items: members read" ON saved_items FOR SELECT TO authenticated USING (public.is_org_member(organization_id));
--> statement-breakpoint
CREATE POLICY "job_item_settings: members read" ON job_item_settings FOR SELECT TO authenticated USING (public.is_org_member(organization_id));
