-- The in-app inbox: a notification is read once its person has seen it.
ALTER TABLE "notifications" ADD COLUMN "read_at" timestamp with time zone;--> statement-breakpoint
CREATE INDEX "notifications_user_feed_idx" ON "notifications" USING btree ("user_id","organization_id","created_at");--> statement-breakpoint

-- Texts, alongside email and push. Null means "the catalog's default".
ALTER TABLE "notification_preferences" ADD COLUMN "sms" boolean;--> statement-breakpoint

-- Held for the daily summary rather than sent on its own.
ALTER TABLE "notification_deliveries" ADD COLUMN "digest" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "notification_deliveries" DROP CONSTRAINT "notification_deliveries_channel";--> statement-breakpoint
ALTER TABLE "notification_deliveries" ADD CONSTRAINT "notification_deliveries_channel" CHECK ("notification_deliveries"."channel" in ('email', 'push', 'sms'));--> statement-breakpoint

-- How one person is reached, across every event: the number texts go to, how
-- often email comes, the hours texts wait through, and whether the app pops
-- things up. A row exists only once somebody has saved the screen.
CREATE TABLE "notification_settings" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"email_frequency" text DEFAULT 'instant' NOT NULL,
	"digest_hour" integer DEFAULT 8 NOT NULL,
	"sms_phone" text,
	"quiet_hours" boolean DEFAULT false NOT NULL,
	"quiet_start" integer DEFAULT 21 NOT NULL,
	"quiet_end" integer DEFAULT 7 NOT NULL,
	"time_zone" text,
	"toasts" boolean DEFAULT true NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "notification_settings_email_frequency" CHECK ("notification_settings"."email_frequency" in ('instant', 'daily')),
	CONSTRAINT "notification_settings_hours" CHECK ("notification_settings"."digest_hour" between 0 and 23 and "notification_settings"."quiet_start" between 0 and 23 and "notification_settings"."quiet_end" between 0 and 23)
);--> statement-breakpoint
ALTER TABLE "notification_settings" ADD CONSTRAINT "notification_settings_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint

-- Theirs alone, like their preferences.
alter table public.notification_settings enable row level security;--> statement-breakpoint
create policy "notification_settings: read your own"
  on public.notification_settings for select to authenticated
  using (user_id = (select auth.uid()));--> statement-breakpoint
create policy "notification_settings: add your own"
  on public.notification_settings for insert to authenticated
  with check (user_id = (select auth.uid()));--> statement-breakpoint
create policy "notification_settings: update your own"
  on public.notification_settings for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));--> statement-breakpoint

-- Marking read is the one write a person makes to their own notifications.
create policy "notifications: mark your own read"
  on public.notifications for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));
