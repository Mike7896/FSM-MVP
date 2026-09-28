-- ===========================================================================
-- Row Level Security, triggers and storage
--
-- Drizzle connects as the `postgres` role, which BYPASSES every policy below.
-- Authorization for app queries therefore lives in lib/dal.ts. These policies
-- are defence in depth: they are what protects the data when it is reached
-- through PostgREST, the Supabase JS client, or a leaked publishable key.
--
-- The shape repeats: shop-tree rows are scoped by `organization_id`, job-tree
-- rows by the organization of the Job they belong to, and grandchildren by
-- their parent. `can_access_job()` carries that second case so it is written
-- once rather than twenty times.
-- ===========================================================================


-- ---------------------------------------------------------------------------
-- Helpers
--
-- SECURITY DEFINER is load-bearing: a policy on `memberships` that itself
-- SELECTs from `memberships` recurses infinitely. Running the lookup as the
-- function owner sidesteps RLS and breaks the cycle. The same applies to
-- can_access_job, which reads `jobs` from inside policies on the job tree.
-- ---------------------------------------------------------------------------

create or replace function public.is_org_member(org_id uuid)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (
    select 1 from public.memberships m
    where m.organization_id = org_id
      and m.user_id = (select auth.uid())
  );
$$;

create or replace function public.has_org_role(org_id uuid, roles public.member_role[])
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (
    select 1 from public.memberships m
    where m.organization_id = org_id
      and m.user_id = (select auth.uid())
      and m.role = any(roles)
  );
$$;

create or replace function public.can_access_job(target_job_id uuid)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (
    select 1
    from public.jobs j
    join public.memberships m on m.organization_id = j.organization_id
    where j.id = target_job_id
      and m.user_id = (select auth.uid())
  );
$$;

revoke execute on function public.is_org_member(uuid) from public;
revoke execute on function public.has_org_role(uuid, public.member_role[]) from public;
revoke execute on function public.can_access_job(uuid) from public;
grant execute on function public.is_org_member(uuid) to authenticated;
grant execute on function public.has_org_role(uuid, public.member_role[]) to authenticated;
grant execute on function public.can_access_job(uuid) to authenticated;
--> statement-breakpoint


-- ---------------------------------------------------------------------------
-- Enable RLS everywhere. A table with RLS on and no policy denies all access,
-- which is the correct default for the Stripe read-model.
-- ---------------------------------------------------------------------------

alter table public.profiles          enable row level security;
alter table public.organizations     enable row level security;
alter table public.memberships       enable row level security;
alter table public.customers         enable row level security;
alter table public.licenses          enable row level security;
alter table public.presets           enable row level security;
alter table public.pack_entitlements enable row level security;
alter table public.pack_enablement   enable row level security;

alter table public.jobs              enable row level security;
alter table public.quotes            enable row level security;
alter table public.contracts         enable row level security;
alter table public.change_orders     enable row level security;
alter table public.invoices          enable row level security;
alter table public.payments          enable row level security;
alter table public.line_items        enable row level security;
alter table public.options           enable row level security;
alter table public.option_line_items enable row level security;
alter table public.permits           enable row level security;
alter table public.inspections       enable row level security;
alter table public.capture_artifacts enable row level security;
alter table public.evidence          enable row level security;
alter table public.evidence_photos   enable row level security;
alter table public.receipts          enable row level security;
alter table public.messages          enable row level security;
alter table public.share_links       enable row level security;

alter table public.stripe_customers  enable row level security;
alter table public.products          enable row level security;
alter table public.prices            enable row level security;
alter table public.subscriptions     enable row level security;
alter table public.stripe_events     enable row level security;
--> statement-breakpoint


-- ---------------------------------------------------------------------------
-- profiles
-- ---------------------------------------------------------------------------

create policy "profiles: read own"
  on public.profiles for select to authenticated
  using (id = (select auth.uid()));

-- Lets teammates see each other's names on a job.
create policy "profiles: read org co-members"
  on public.profiles for select to authenticated
  using (
    exists (
      select 1
      from public.memberships mine
      join public.memberships theirs
        on theirs.organization_id = mine.organization_id
      where mine.user_id = (select auth.uid())
        and theirs.user_id = public.profiles.id
    )
  );

create policy "profiles: update own"
  on public.profiles for update to authenticated
  using (id = (select auth.uid()))
  with check (id = (select auth.uid()));
--> statement-breakpoint


-- ---------------------------------------------------------------------------
-- The shop tree — scoped by organization_id
-- ---------------------------------------------------------------------------

create policy "organizations: read own"
  on public.organizations for select to authenticated
  using (public.is_org_member(id));

create policy "organizations: insert as creator"
  on public.organizations for insert to authenticated
  with check (created_by = (select auth.uid()));

create policy "organizations: owners and admins update"
  on public.organizations for update to authenticated
  using (public.has_org_role(id, array['owner','admin']::public.member_role[]))
  with check (public.has_org_role(id, array['owner','admin']::public.member_role[]));

create policy "organizations: owners delete"
  on public.organizations for delete to authenticated
  using (public.has_org_role(id, array['owner']::public.member_role[]));

create policy "memberships: read own org"
  on public.memberships for select to authenticated
  using (public.is_org_member(organization_id));

create policy "memberships: owners and admins manage"
  on public.memberships for all to authenticated
  using (public.has_org_role(organization_id, array['owner','admin']::public.member_role[]))
  with check (public.has_org_role(organization_id, array['owner','admin']::public.member_role[]));

create policy "customers: org members full access"
  on public.customers for all to authenticated
  using (public.is_org_member(organization_id))
  with check (public.is_org_member(organization_id));

create policy "licenses: org members full access"
  on public.licenses for all to authenticated
  using (public.is_org_member(organization_id))
  with check (public.is_org_member(organization_id));

create policy "presets: org members full access"
  on public.presets for all to authenticated
  using (public.is_org_member(organization_id))
  with check (public.is_org_member(organization_id));

-- Entitlement is granted by the billing rail, never by the app: read only.
create policy "pack_entitlements: org members read"
  on public.pack_entitlements for select to authenticated
  using (public.is_org_member(organization_id));

-- Enablement is the contractor's switch, so they own it.
create policy "pack_enablement: org members manage"
  on public.pack_enablement for all to authenticated
  using (public.is_org_member(organization_id))
  with check (public.is_org_member(organization_id));
--> statement-breakpoint


-- ---------------------------------------------------------------------------
-- The job tree — one shape, repeated
-- ---------------------------------------------------------------------------

create policy "jobs: org members full access"
  on public.jobs for all to authenticated
  using (public.is_org_member(organization_id))
  with check (public.is_org_member(organization_id));

create policy "quotes: job members full access"
  on public.quotes for all to authenticated
  using (public.can_access_job(job_id))
  with check (public.can_access_job(job_id));

create policy "contracts: job members full access"
  on public.contracts for all to authenticated
  using (public.can_access_job(job_id))
  with check (public.can_access_job(job_id));

create policy "change_orders: job members full access"
  on public.change_orders for all to authenticated
  using (public.can_access_job(job_id))
  with check (public.can_access_job(job_id));

create policy "invoices: job members full access"
  on public.invoices for all to authenticated
  using (public.can_access_job(job_id))
  with check (public.can_access_job(job_id));

create policy "payments: job members full access"
  on public.payments for all to authenticated
  using (public.can_access_job(job_id))
  with check (public.can_access_job(job_id));

create policy "permits: job members full access"
  on public.permits for all to authenticated
  using (public.can_access_job(job_id))
  with check (public.can_access_job(job_id));

create policy "inspections: job members full access"
  on public.inspections for all to authenticated
  using (public.can_access_job(job_id))
  with check (public.can_access_job(job_id));

create policy "capture_artifacts: job members full access"
  on public.capture_artifacts for all to authenticated
  using (public.can_access_job(job_id))
  with check (public.can_access_job(job_id));

create policy "evidence: job members full access"
  on public.evidence for all to authenticated
  using (public.can_access_job(job_id))
  with check (public.can_access_job(job_id));

create policy "receipts: job members full access"
  on public.receipts for all to authenticated
  using (public.can_access_job(job_id))
  with check (public.can_access_job(job_id));

create policy "messages: job members full access"
  on public.messages for all to authenticated
  using (public.can_access_job(job_id))
  with check (public.can_access_job(job_id));

create policy "share_links: job members full access"
  on public.share_links for all to authenticated
  using (public.can_access_job(job_id))
  with check (public.can_access_job(job_id));
--> statement-breakpoint


-- ---------------------------------------------------------------------------
-- Grandchildren — reached through their parent
--
-- A line item belongs to exactly one of a Quote or a Change order, so the
-- policy checks whichever one is set.
-- ---------------------------------------------------------------------------

create policy "line_items: through parent document"
  on public.line_items for all to authenticated
  using (
    exists (
      select 1 from public.quotes q
      where q.id = public.line_items.quote_id
        and public.can_access_job(q.job_id)
    )
    or exists (
      select 1 from public.change_orders co
      where co.id = public.line_items.change_order_id
        and public.can_access_job(co.job_id)
    )
  )
  with check (
    exists (
      select 1 from public.quotes q
      where q.id = public.line_items.quote_id
        and public.can_access_job(q.job_id)
    )
    or exists (
      select 1 from public.change_orders co
      where co.id = public.line_items.change_order_id
        and public.can_access_job(co.job_id)
    )
  );

create policy "options: through quote"
  on public.options for all to authenticated
  using (
    exists (
      select 1 from public.quotes q
      where q.id = public.options.quote_id and public.can_access_job(q.job_id)
    )
  )
  with check (
    exists (
      select 1 from public.quotes q
      where q.id = public.options.quote_id and public.can_access_job(q.job_id)
    )
  );

create policy "option_line_items: through option"
  on public.option_line_items for all to authenticated
  using (
    exists (
      select 1
      from public.options o
      join public.quotes q on q.id = o.quote_id
      where o.id = public.option_line_items.option_id
        and public.can_access_job(q.job_id)
    )
  )
  with check (
    exists (
      select 1
      from public.options o
      join public.quotes q on q.id = o.quote_id
      where o.id = public.option_line_items.option_id
        and public.can_access_job(q.job_id)
    )
  );

create policy "evidence_photos: through evidence"
  on public.evidence_photos for all to authenticated
  using (
    exists (
      select 1 from public.evidence e
      where e.id = public.evidence_photos.evidence_id
        and public.can_access_job(e.job_id)
    )
  )
  with check (
    exists (
      select 1 from public.evidence e
      where e.id = public.evidence_photos.evidence_id
        and public.can_access_job(e.job_id)
    )
  );
--> statement-breakpoint


-- ---------------------------------------------------------------------------
-- Billing: readable by the organization, writable only by the service role
-- (the Stripe webhook). No INSERT/UPDATE/DELETE policies exist, so those are
-- denied for every normal user — which is the point. Stripe is the only thing
-- allowed to change what someone is paying.
-- ---------------------------------------------------------------------------

create policy "stripe_customers: org members read"
  on public.stripe_customers for select to authenticated
  using (public.is_org_member(organization_id));

create policy "subscriptions: org members read"
  on public.subscriptions for select to authenticated
  using (public.is_org_member(organization_id));

-- The plan catalogue is public so pricing pages render before sign-in.
create policy "products: readable"
  on public.products for select to authenticated, anon
  using (active = true);

create policy "prices: readable"
  on public.prices for select to authenticated, anon
  using (active = true);

-- public.stripe_events intentionally has no policies: service role only.
--> statement-breakpoint


-- ---------------------------------------------------------------------------
-- New user -> profile row
--
-- SECURITY DEFINER because the inserting session is Supabase's auth machinery,
-- which has no rights on public.profiles.
--
-- Google spells the display name and avatar differently from our own email
-- signup (`name`/`picture` rather than `full_name`/`avatar_url`), so both are
-- coalesced. `nullif(..., '')` matters: an absent claim arrives as an empty
-- string rather than NULL, and COALESCE would stop at it.
-- ---------------------------------------------------------------------------

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, email, full_name, avatar_url)
  values (
    new.id,
    new.email,
    coalesce(
      nullif(new.raw_user_meta_data ->> 'full_name', ''),
      nullif(new.raw_user_meta_data ->> 'name', ''),
      nullif(concat_ws(
        ' ',
        nullif(new.raw_user_meta_data ->> 'given_name', ''),
        nullif(new.raw_user_meta_data ->> 'family_name', '')
      ), '')
    ),
    coalesce(
      nullif(new.raw_user_meta_data ->> 'avatar_url', ''),
      nullif(new.raw_user_meta_data ->> 'picture', '')
    )
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();
--> statement-breakpoint


-- ---------------------------------------------------------------------------
-- updated_at maintenance
-- ---------------------------------------------------------------------------

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

do $$
declare
  t text;
begin
  foreach t in array array[
    'profiles', 'organizations', 'customers', 'licenses', 'presets',
    'jobs', 'quotes', 'contracts', 'change_orders', 'invoices',
    'permits', 'inspections', 'subscriptions'
  ]
  loop
    execute format('drop trigger if exists set_updated_at on public.%I', t);
    execute format(
      'create trigger set_updated_at before update on public.%I
       for each row execute function public.set_updated_at()', t);
  end loop;
end $$;
--> statement-breakpoint


-- ---------------------------------------------------------------------------
-- Human-facing document numbers
--
-- The advisory lock serialises concurrent inserts for one scope, so two
-- dispatchers creating a job at the same moment cannot both take #1043. It is
-- transaction-scoped and released on commit.
--
-- Jobs, quotes and invoices number per organization — a contractor says "quote
-- 1042", not "job 7's quote 2". Change orders number per job, because they are
-- always spoken about relative to the contract they amend.
-- ---------------------------------------------------------------------------

create or replace function public.set_job_number()
returns trigger
language plpgsql
as $$
begin
  if new.number is null or new.number = 0 then
    perform pg_advisory_xact_lock(hashtextextended(new.organization_id::text, 0));
    select coalesce(max(number), 0) + 1 into new.number
      from public.jobs where organization_id = new.organization_id;
  end if;
  return new;
end;
$$;

drop trigger if exists set_job_number on public.jobs;
create trigger set_job_number before insert on public.jobs
  for each row execute function public.set_job_number();

create or replace function public.set_quote_number()
returns trigger
language plpgsql
as $$
declare
  org uuid;
begin
  if new.number is null or new.number = 0 then
    select organization_id into org from public.jobs where id = new.job_id;
    perform pg_advisory_xact_lock(hashtextextended('quote:' || org::text, 0));
    select coalesce(max(q.number), 0) + 1 into new.number
      from public.quotes q
      join public.jobs j on j.id = q.job_id
     where j.organization_id = org;
  end if;
  return new;
end;
$$;

drop trigger if exists set_quote_number on public.quotes;
create trigger set_quote_number before insert on public.quotes
  for each row execute function public.set_quote_number();

create or replace function public.set_invoice_number()
returns trigger
language plpgsql
as $$
declare
  org uuid;
begin
  if new.number is null or new.number = 0 then
    select organization_id into org from public.jobs where id = new.job_id;
    perform pg_advisory_xact_lock(hashtextextended('invoice:' || org::text, 0));
    select coalesce(max(i.number), 0) + 1 into new.number
      from public.invoices i
      join public.jobs j on j.id = i.job_id
     where j.organization_id = org;
  end if;
  return new;
end;
$$;

drop trigger if exists set_invoice_number on public.invoices;
create trigger set_invoice_number before insert on public.invoices
  for each row execute function public.set_invoice_number();

create or replace function public.set_change_order_number()
returns trigger
language plpgsql
as $$
begin
  if new.number is null or new.number = 0 then
    perform pg_advisory_xact_lock(hashtextextended('co:' || new.job_id::text, 0));
    select coalesce(max(number), 0) + 1 into new.number
      from public.change_orders where job_id = new.job_id;
  end if;
  return new;
end;
$$;

drop trigger if exists set_change_order_number on public.change_orders;
create trigger set_change_order_number before insert on public.change_orders
  for each row execute function public.set_change_order_number();
--> statement-breakpoint


-- ---------------------------------------------------------------------------
-- Jurisdiction on a Job
--
-- Derived from the address, and it is what a License and a Permit are matched
-- on. Left alone when set explicitly — the app knows more than a string parse
-- once a real geocoder is wired in.
-- ---------------------------------------------------------------------------

create or replace function public.set_job_jurisdiction()
returns trigger
language plpgsql
as $$
begin
  if new.jurisdiction is null and new.address is not null then
    -- Placeholder: last comma-separated component, trimmed. Replaced by a
    -- geocoder lookup when one lands.
    new.jurisdiction := nullif(btrim(split_part(new.address, ',', 2)), '');
  end if;
  return new;
end;
$$;

drop trigger if exists set_job_jurisdiction on public.jobs;
create trigger set_job_jurisdiction before insert or update on public.jobs
  for each row execute function public.set_job_jurisdiction();
--> statement-breakpoint


-- ---------------------------------------------------------------------------
-- Storage
--
-- Object paths are `<organization_id>/...`, so one policy per operation covers
-- every object by checking the first path segment against membership.
-- ---------------------------------------------------------------------------

create or replace function public.org_id_from_path(object_name text)
returns uuid
language plpgsql
immutable
as $$
begin
  return (storage.foldername(object_name))[1]::uuid;
exception when others then
  return null;
end;
$$;

revoke execute on function public.org_id_from_path(text) from public;
grant execute on function public.org_id_from_path(text) to authenticated;

insert into storage.buckets (id, name, public)
values ('job-attachments', 'job-attachments', false)
on conflict (id) do nothing;

insert into storage.buckets (id, name, public)
values ('avatars', 'avatars', true)
on conflict (id) do nothing;

drop policy if exists "job-attachments: org members read" on storage.objects;
create policy "job-attachments: org members read"
  on storage.objects for select to authenticated
  using (
    bucket_id = 'job-attachments'
    and public.is_org_member(public.org_id_from_path(name))
  );

drop policy if exists "job-attachments: org members write" on storage.objects;
create policy "job-attachments: org members write"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'job-attachments'
    and public.is_org_member(public.org_id_from_path(name))
  );

drop policy if exists "job-attachments: org members delete" on storage.objects;
create policy "job-attachments: org members delete"
  on storage.objects for delete to authenticated
  using (
    bucket_id = 'job-attachments'
    and public.is_org_member(public.org_id_from_path(name))
  );

drop policy if exists "avatars: public read" on storage.objects;
create policy "avatars: public read"
  on storage.objects for select to authenticated, anon
  using (bucket_id = 'avatars');

drop policy if exists "avatars: write own" on storage.objects;
create policy "avatars: write own"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'avatars'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

drop policy if exists "avatars: update own" on storage.objects;
create policy "avatars: update own"
  on storage.objects for update to authenticated
  using (
    bucket_id = 'avatars'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );
