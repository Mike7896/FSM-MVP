CREATE TYPE "public"."tour_status" AS ENUM('in_progress', 'completed', 'skipped');--> statement-breakpoint
CREATE TABLE "tour_progress" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"tour_id" text NOT NULL,
	"status" "tour_status" NOT NULL,
	"step_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "tour_progress" ADD CONSTRAINT "tour_progress_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "tour_progress_user_tour_key" ON "tour_progress" USING btree ("user_id","tour_id");--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- Tour progress belongs to one person. Readable and writable by that person
-- only; the app writes through the API as the postgres role, and these keep
-- the Data API from exposing anyone else rows.
-- ---------------------------------------------------------------------------
alter table public.tour_progress enable row level security;--> statement-breakpoint
create policy "tour_progress: read your own"
  on public.tour_progress for select to authenticated
  using (user_id = (select auth.uid()));--> statement-breakpoint
create policy "tour_progress: add your own"
  on public.tour_progress for insert to authenticated
  with check (user_id = (select auth.uid()));--> statement-breakpoint
create policy "tour_progress: update your own"
  on public.tour_progress for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));
