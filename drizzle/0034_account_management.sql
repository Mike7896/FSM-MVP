-- Account management for the admin panel: who's an admin, who's a tester, and
-- who's been suspended.
--
-- **Admins live in the database now.** `ADMIN_EMAILS` names the owners — always
-- admins, never removable from the panel — and an owner can make anyone else an
-- admin here. The table is what RLS (and so the live feed) checks either way.
--
-- **A policy per person, only when they need one.** No row means an ordinary
-- account. A row can make someone a tester (with an end date and a daily cap
-- on documents sent), give them a complimentary plan, or record a suspension
-- — the suspension itself is enforced by Supabase Auth's ban, which stops
-- sign-in and token refresh; this row is the reason and who decided it.

ALTER TABLE "platform_admins" ADD COLUMN "granted_by" uuid;--> statement-breakpoint
ALTER TABLE "platform_admins" ADD COLUMN "note" text;--> statement-breakpoint

CREATE TABLE "account_policies" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"kind" text DEFAULT 'standard' NOT NULL,
	"comp_plan" boolean DEFAULT false NOT NULL,
	"access_until" date,
	"daily_send_limit" integer,
	"note" text,
	"banned_at" timestamp with time zone,
	"banned_reason" text,
	"banned_by" uuid,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "account_policies_kind_check" CHECK ("account_policies"."kind" in ('standard', 'tester')),
	CONSTRAINT "account_policies_limit_check" CHECK ("account_policies"."daily_send_limit" is null or "account_policies"."daily_send_limit" >= 0)
);--> statement-breakpoint
ALTER TABLE "account_policies" ADD CONSTRAINT "account_policies_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "account_policies_kind_idx" ON "account_policies" USING btree ("kind");--> statement-breakpoint
CREATE INDEX "account_policies_access_until_idx" ON "account_policies" USING btree ("access_until") WHERE "access_until" is not null;--> statement-breakpoint

alter table public.account_policies enable row level security;--> statement-breakpoint
create policy "account_policies: own read"
  on public.account_policies for select to authenticated
  using (user_id = auth.uid() or public.is_platform_admin());
