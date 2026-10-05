-- Two fixes to the admin dashboard, both in the database, because that's where
-- the event log is written.
--
-- **One rule for "test", kept in one place.** The log marked a line test only
-- when its shop's address had "check-" in it. A script that named its shops any
-- other way — and every sign-in by a check script's throwaway account — went to
-- the live dashboard as real news, 81 made-up "bought Pro" lines among them. The
-- dashboard's own numbers had the same blind spot for the API smoke test's two
-- standing shops. Now:
--
--   - a person is test when their sign-in address is at a reserved domain
--     (RFC 2606 / 6761 — only the check scripts sign up with those), or they
--     belong to a check script's shop;
--   - a shop is test when its address says "check-", or everyone in it is a
--     test person.
--
-- The log asks these two functions as it writes, and lib/admin/metrics.ts asks
-- the same two when it counts, so the feed and the numbers can't disagree.
--
-- **The live dashboard follows the database.** Every write that can move a
-- number on /admin sends a one-word signal on a private Realtime channel,
-- `admin:live`, and the dashboard re-reads its numbers. RLS lets only platform
-- admins hear it. Like every trigger here, a signal that fails is a warning in
-- the Postgres log, never a failed write.
--
-- Rerunnable.

-- ── Who's a test ───────────────────────────────────────────────────────────
-- Plain SQL with no SET clause, so Postgres can inline them into the
-- dashboard's counting queries; every name is schema-qualified instead.

create or replace function public.admin_is_test_user(p_user uuid)
returns boolean
language sql
stable
as $$
  select p_user is not null and (
    exists (
      select 1 from auth.users u
      where u.id = p_user
        and u.email ~* '(@example\.(com|net|org)|\.(local|localhost|invalid|test|example))$'
    )
    or exists (
      select 1 from public.memberships m
      join public.organizations o on o.id = m.organization_id
      where m.user_id = p_user and o.slug ~ '(^|-)check-'
    )
  );
$$;--> statement-breakpoint

create or replace function public.admin_is_test_org(p_org uuid)
returns boolean
language sql
stable
as $$
  select p_org is not null and exists (
    select 1 from public.organizations o
    where o.id = p_org
      and (
        o.slug ~ '(^|-)check-'
        or (
          exists (select 1 from public.memberships m where m.organization_id = o.id)
          and not exists (
            select 1 from public.memberships m
            left join auth.users u on u.id = m.user_id
            where m.organization_id = o.id
              and not coalesce(u.email ~* '(@example\.(com|net|org)|\.(local|localhost|invalid|test|example))$', false)
          )
        )
      )
  );
$$;--> statement-breakpoint

-- ── Writing a line, with the rule ──────────────────────────────────────────

create or replace function public.admin_log(
  p_kind text,
  p_level text,
  p_org uuid,
  p_user uuid,
  p_title text,
  p_amount bigint default null,
  p_demo boolean default false,
  p_data jsonb default '{}'::jsonb
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_name text;
begin
  if p_org is not null then
    select name into v_name from public.organizations where id = p_org;
  end if;
  insert into public.admin_events
    (kind, level, organization_id, org_name, user_id, title, amount_cents, test, demo, data)
  values (
    p_kind,
    p_level,
    p_org,
    v_name,
    p_user,
    replace(p_title, '{org}', coalesce(v_name, 'A business')),
    p_amount,
    public.admin_is_test_org(p_org)
      or public.admin_is_test_user(p_user)
      or coalesce((p_data ->> 'test')::boolean, false),
    coalesce(p_demo, false),
    coalesce(p_data, '{}'::jsonb) - 'test'
  );
exception when others then
  raise warning 'admin_log(%) failed: %', p_kind, sqlerrm;
end;
$$;--> statement-breakpoint

-- ── The lines already written ──────────────────────────────────────────────
-- Everything the rule above catches, plus what it can't see any more: shops a
-- check script made under another name and has since deleted, known now only
-- by the names those scripts gave them, and test people whose accounts are
-- gone but whose address is still in the line.

update public.admin_events e
set test = true
where not e.test
  and (
    public.admin_is_test_org(e.organization_id)
    or public.admin_is_test_user(e.user_id)
    or e.title ~* '@[^@\s]*(example\.(com|net|org)|\.(local|localhost|invalid|test|example))(\s|$)'
    or coalesce(e.data ->> 'email', '') ~* '(@example\.(com|net|org)|\.(local|localhost|invalid|test|example))$'
    or (
      e.organization_id is not null
      and not exists (select 1 from public.organizations o where o.id = e.organization_id)
      and e.org_name in (
        -- scripts/membership-scenarios.mts
        'Add pack', 'Annual', 'Cancel', 'Declined upgrade', 'Downgrade then pack', 'Founder',
        'Guarantee', 'Interval switch', 'Out of order', 'Renewal fails', 'Starter Electrical',
        'Tiny proration', 'Upgrade', 'Write-off',
        -- scripts/documents-check.mts, scripts/contract-send-check.mts
        'Somebody Else',
        -- scripts/tags-check.mts
        'Tag test', 'Tag test other'
      )
    )
  );--> statement-breakpoint

-- ── The live signal ────────────────────────────────────────────────────────

create or replace function public.admin_signal()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform realtime.send(jsonb_build_object('table', tg_table_name), 'changed', 'admin:live', true);
  return null;
exception when others then
  raise warning 'admin_signal(%) failed: %', tg_table_name, sqlerrm;
  return null;
end;
$$;--> statement-breakpoint

-- Once per statement, not per row: a bulk write is one signal, and the
-- dashboard re-reads everything anyway.
do $$
declare
  t text;
begin
  -- Any write can move a number.
  foreach t in array array[
    'profiles', 'organizations', 'memberships', 'account_policies',
    'subscriptions', 'billing_accounts', 'prices', 'products',
    'ledger_entries', 'document_sends', 'connected_accounts',
    'support_requests', 'notification_deliveries', 'stripe_events', 'platform_admins'
  ] loop
    execute format('drop trigger if exists admin_signal on public.%I', t);
    execute format(
      'create trigger admin_signal after insert or update or delete on public.%I
         for each statement execute function public.admin_signal()', t);
  end loop;

  -- Edited all day long; only a new or removed row moves a number. The one
  -- edit that matters to each is handled below.
  foreach t in array array['documents', 'jobs', 'visits', 'tasks'] loop
    execute format('drop trigger if exists admin_signal on public.%I', t);
    execute format(
      'create trigger admin_signal after insert or delete on public.%I
         for each statement execute function public.admin_signal()', t);
  end loop;
end $$;--> statement-breakpoint

-- A quote opened, won or declined — not every autosave.
drop trigger if exists admin_signal_status on public.documents;--> statement-breakpoint
create trigger admin_signal_status after update of status on public.documents
  for each row when (old.status is distinct from new.status)
  execute function public.admin_signal();--> statement-breakpoint

-- A job moving in or out of demo changes what counts.
drop trigger if exists admin_signal_demo on public.jobs;--> statement-breakpoint
create trigger admin_signal_demo after update of is_demo on public.jobs
  for each row when (old.is_demo is distinct from new.is_demo)
  execute function public.admin_signal();--> statement-breakpoint

-- Only platform admins may join the channel, and so hear the signal.
drop policy if exists "admin:live — platform admins receive" on realtime.messages;--> statement-breakpoint
create policy "admin:live — platform admins receive"
  on realtime.messages for select to authenticated
  using (realtime.topic() = 'admin:live' and public.is_platform_admin());
