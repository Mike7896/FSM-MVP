CREATE TABLE "notification_deliveries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"notification_id" uuid NOT NULL,
	"channel" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"next_attempt_at" timestamp with time zone DEFAULT now() NOT NULL,
	"claimed_at" timestamp with time zone,
	"recipient" text,
	"provider_message_id" text,
	"last_error" text,
	"sent_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "notification_deliveries_channel" CHECK ("notification_deliveries"."channel" in ('email', 'push')),
	CONSTRAINT "notification_deliveries_status" CHECK ("notification_deliveries"."status" in ('pending', 'sending', 'sent', 'failed', 'dead', 'skipped'))
);
--> statement-breakpoint
CREATE TABLE "notification_preferences" (
	"user_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"push" boolean NOT NULL,
	"email" boolean NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "notification_preferences_user_id_kind_pk" PRIMARY KEY("user_id","kind")
);
--> statement-breakpoint
CREATE TABLE "notifications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"title" text NOT NULL,
	"body" text NOT NULL,
	"href" text NOT NULL,
	"dedupe_key" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "notification_deliveries" ADD CONSTRAINT "notification_deliveries_notification_id_notifications_id_fk" FOREIGN KEY ("notification_id") REFERENCES "public"."notifications"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification_preferences" ADD CONSTRAINT "notification_preferences_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "notification_deliveries_channel_key" ON "notification_deliveries" USING btree ("notification_id","channel");--> statement-breakpoint
CREATE INDEX "notification_deliveries_due_idx" ON "notification_deliveries" USING btree ("status","next_attempt_at");--> statement-breakpoint
CREATE UNIQUE INDEX "notifications_user_dedupe_key" ON "notifications" USING btree ("user_id","dedupe_key");--> statement-breakpoint
CREATE INDEX "notifications_organization_dedupe_idx" ON "notifications" USING btree ("organization_id","dedupe_key");--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- A notification belongs to the person it is addressed to, and so do their
-- preferences. Readable (and, for preferences, writable) by that person only;
-- the app writes through the API as the postgres role, and these keep the Data
-- API from exposing anyone else's.
--
-- Deliveries get RLS and no policies at all: they are the sender's
-- bookkeeping, and with nothing granted the Data API cannot reach them.
-- ---------------------------------------------------------------------------
alter table public.notifications enable row level security;--> statement-breakpoint
create policy "notifications: read your own"
  on public.notifications for select to authenticated
  using (user_id = (select auth.uid()));--> statement-breakpoint
alter table public.notification_deliveries enable row level security;--> statement-breakpoint
alter table public.notification_preferences enable row level security;--> statement-breakpoint
create policy "notification_preferences: read your own"
  on public.notification_preferences for select to authenticated
  using (user_id = (select auth.uid()));--> statement-breakpoint
create policy "notification_preferences: add your own"
  on public.notification_preferences for insert to authenticated
  with check (user_id = (select auth.uid()));--> statement-breakpoint
create policy "notification_preferences: update your own"
  on public.notification_preferences for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));