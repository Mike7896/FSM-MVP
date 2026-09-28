-- Support requests: problems, ideas, and asks for a person's help, as the
-- contractor sent them. Kept here first; Sentry and the support inbox are
-- where they're read.

CREATE TYPE "public"."support_kind" AS ENUM('bug', 'idea', 'help');--> statement-breakpoint
CREATE TYPE "public"."support_status" AS ENUM('open', 'answered', 'closed');--> statement-breakpoint
CREATE TABLE "support_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"number" integer GENERATED ALWAYS AS IDENTITY (sequence name "support_requests_number_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1001 CACHE 1),
	"organization_id" uuid,
	"user_id" uuid,
	"kind" "support_kind" NOT NULL,
	"subject" text NOT NULL,
	"body" text NOT NULL,
	"reply_to" text NOT NULL,
	"page" text,
	"user_agent" text,
	"sentry_event_id" text,
	"emailed_at" timestamp with time zone,
	"status" "support_status" DEFAULT 'open' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "support_requests_subject_check" CHECK (length(btrim("support_requests"."subject")) between 1 and 140),
	CONSTRAINT "support_requests_body_check" CHECK (length(btrim("support_requests"."body")) between 1 and 5000)
);--> statement-breakpoint
ALTER TABLE "support_requests" ADD CONSTRAINT "support_requests_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "support_requests" ADD CONSTRAINT "support_requests_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "support_requests_user_idx" ON "support_requests" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "support_requests_status_idx" ON "support_requests" USING btree ("status","created_at");--> statement-breakpoint

-- A person reads their own requests; nobody reads anyone else's.
alter table public.support_requests enable row level security;--> statement-breakpoint
create policy "support_requests: sender reads own"
  on public.support_requests for select to authenticated
  using (user_id = auth.uid());
