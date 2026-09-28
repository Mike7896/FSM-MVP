CREATE TYPE "public"."draw_gate" AS ENUM('on_acceptance', 'phase_complete', 'inspection_passed', 'on_completion');--> statement-breakpoint
CREATE TABLE "draw_schedule" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"job_id" uuid NOT NULL,
	"contract_id" uuid,
	"position" integer DEFAULT 0 NOT NULL,
	"name" text NOT NULL,
	"amount_cents" integer DEFAULT 0 NOT NULL,
	"gate" "draw_gate" DEFAULT 'phase_complete' NOT NULL,
	"inspection_type" "inspection_type",
	"invoice_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "draw_schedule" ADD CONSTRAINT "draw_schedule_job_id_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."jobs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "draw_schedule" ADD CONSTRAINT "draw_schedule_contract_id_contracts_id_fk" FOREIGN KEY ("contract_id") REFERENCES "public"."contracts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "draw_schedule" ADD CONSTRAINT "draw_schedule_invoice_id_invoices_id_fk" FOREIGN KEY ("invoice_id") REFERENCES "public"."invoices"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "draw_schedule_job_id_idx" ON "draw_schedule" USING btree ("job_id");--> statement-breakpoint
CREATE UNIQUE INDEX "draw_schedule_job_position_unique" ON "draw_schedule" USING btree ("job_id","position");--> statement-breakpoint
-- RLS, matching every other job-scoped table in 0001. Drizzle connects as a
-- role that bypasses this, so the DAL and the API's `requireOrg` remain the
-- real authorization — but a table left without a policy is a hole for anything
-- arriving through PostgREST or the Supabase client.
ALTER TABLE "draw_schedule" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "draw_schedule: job members full access"
  ON public.draw_schedule FOR ALL TO authenticated
  USING (public.can_access_job(job_id))
  WITH CHECK (public.can_access_job(job_id));
