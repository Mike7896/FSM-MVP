CREATE TABLE "share_link_views" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"share_link_id" uuid NOT NULL,
	"viewed_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "customers" ADD COLUMN "is_demo" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "organizations" ADD COLUMN "trade" text;--> statement-breakpoint
ALTER TABLE "profiles" ADD COLUMN "trade" text;--> statement-breakpoint
ALTER TABLE "profiles" ADD COLUMN "teach_seen_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "profiles" ADD COLUMN "offers_dismissed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "jobs" ADD COLUMN "is_demo" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "quotes" ADD COLUMN "sent_channel" text;--> statement-breakpoint
ALTER TABLE "quotes" ADD COLUMN "sent_to" text;--> statement-breakpoint
ALTER TABLE "share_link_views" ADD CONSTRAINT "share_link_views_share_link_id_share_links_id_fk" FOREIGN KEY ("share_link_id") REFERENCES "public"."share_links"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "share_link_views_link_idx" ON "share_link_views" USING btree ("share_link_id","viewed_at");--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- Every open of a share link. The app writes and reads these as the postgres
-- role; RLS on with no policies keeps the Data API from exposing who opened
-- what to anyone.
-- ---------------------------------------------------------------------------
alter table public.share_link_views enable row level security;--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- The business's logo. Public to read, because it sits on documents a customer
-- opens with no account. Written only by members of the business whose folder
-- it is — the first path segment is the organization id, the same rule every
-- other bucket follows.
-- ---------------------------------------------------------------------------
insert into storage.buckets (id, name, public)
values ('logos', 'logos', true)
on conflict (id) do nothing;--> statement-breakpoint

drop policy if exists "logos: public read" on storage.objects;--> statement-breakpoint
create policy "logos: public read"
  on storage.objects for select to authenticated, anon
  using (bucket_id = 'logos');--> statement-breakpoint

drop policy if exists "logos: org members write" on storage.objects;--> statement-breakpoint
create policy "logos: org members write"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'logos'
    and public.is_org_member(public.org_id_from_path(name))
  );--> statement-breakpoint

drop policy if exists "logos: org members delete" on storage.objects;--> statement-breakpoint
create policy "logos: org members delete"
  on storage.objects for delete to authenticated
  using (
    bucket_id = 'logos'
    and public.is_org_member(public.org_id_from_path(name))
  );