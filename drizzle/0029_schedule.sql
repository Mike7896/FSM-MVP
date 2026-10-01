CREATE TYPE "public"."visit_kind" AS ENUM('work', 'estimate', 'time_off', 'other');--> statement-breakpoint
CREATE TYPE "public"."visit_status" AS ENUM('scheduled', 'done', 'cancelled');--> statement-breakpoint
CREATE TABLE "visits" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"job_id" uuid,
	"kind" "visit_kind" DEFAULT 'work' NOT NULL,
	"title" text,
	"notes" text,
	"all_day" boolean DEFAULT false NOT NULL,
	"starts_at" timestamp with time zone,
	"ends_at" timestamp with time zone,
	"starts_on" date,
	"ends_on" date,
	"status" "visit_status" DEFAULT 'scheduled' NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "visits_time_shape" CHECK (("visits"."all_day" and "visits"."starts_on" is not null and "visits"."ends_on" is not null and "visits"."ends_on" >= "visits"."starts_on" and "visits"."starts_at" is null and "visits"."ends_at" is null)
        or (not "visits"."all_day" and "visits"."starts_at" is not null and "visits"."ends_at" is not null and "visits"."ends_at" > "visits"."starts_at" and "visits"."starts_on" is null and "visits"."ends_on" is null)),
	CONSTRAINT "visits_job_for_job_work" CHECK ("visits"."kind" not in ('work', 'estimate') or "visits"."job_id" is not null)
);--> statement-breakpoint
CREATE TABLE "visit_assignees" (
	"visit_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	CONSTRAINT "visit_assignees_visit_id_user_id_pk" PRIMARY KEY("visit_id","user_id")
);--> statement-breakpoint
ALTER TABLE "visits" ADD CONSTRAINT "visits_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "visits" ADD CONSTRAINT "visits_job_id_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."jobs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "visits" ADD CONSTRAINT "visits_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "auth"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "visit_assignees" ADD CONSTRAINT "visit_assignees_visit_id_visits_id_fk" FOREIGN KEY ("visit_id") REFERENCES "public"."visits"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "visit_assignees" ADD CONSTRAINT "visit_assignees_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "visits_org_starts_at_idx" ON "visits" USING btree ("organization_id","starts_at");--> statement-breakpoint
CREATE INDEX "visits_org_starts_on_idx" ON "visits" USING btree ("organization_id","starts_on");--> statement-breakpoint
CREATE INDEX "visits_job_idx" ON "visits" USING btree ("job_id");--> statement-breakpoint
CREATE INDEX "visit_assignees_user_idx" ON "visit_assignees" USING btree ("user_id");--> statement-breakpoint

-- The shop's schedule is readable by the shop. The app writes through the API
-- as the postgres role; these keep the Data API from reaching anyone else's.
alter table public.visits enable row level security;--> statement-breakpoint
create policy "visits: members read"
  on public.visits for select to authenticated
  using (public.is_org_member(organization_id));--> statement-breakpoint
alter table public.visit_assignees enable row level security;--> statement-breakpoint
create policy "visit_assignees: members read"
  on public.visit_assignees for select to authenticated
  using (exists (
    select 1 from public.visits v
    where v.id = visit_id and public.is_org_member(v.organization_id)
  ));
