-- Internal accounts: the team's own.
--
-- The founders use the product the way a contractor would — real shops, real
-- quotes, card payments into the Stripe sandbox — and none of it is business.
-- An account switched to internal in Admin → Accounts is left out of every
-- number on the dashboard, and so is a shop where every real person is
-- internal. The feed still shows their lines, marked internal, so a walkthrough
-- can be watched landing.
--
-- `internal` is a separate mark from `test`: test is the check scripts' made-up
-- data and stays hidden; internal is real use that just doesn't count.

ALTER TABLE "account_policies" ADD COLUMN IF NOT EXISTS "internal" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "admin_events" ADD COLUMN IF NOT EXISTS "internal" boolean DEFAULT false NOT NULL;--> statement-breakpoint

create or replace function public.admin_is_internal_user(p_user uuid)
returns boolean
language sql
stable
as $$
  select p_user is not null and exists (
    select 1 from public.account_policies ap where ap.user_id = p_user and ap.internal
  );
$$;--> statement-breakpoint

-- Every real person in it is internal — so one of us joining a customer's shop
-- to help doesn't make their shop ours.
create or replace function public.admin_is_internal_org(p_org uuid)
returns boolean
language sql
stable
as $$
  select p_org is not null
    and exists (
      select 1 from public.memberships m
      join public.account_policies ap on ap.user_id = m.user_id
      where m.organization_id = p_org and ap.internal
    )
    and not exists (
      select 1 from public.memberships m
      join auth.users u on u.id = m.user_id
      left join public.account_policies ap on ap.user_id = m.user_id
      where m.organization_id = p_org
        and coalesce(u.email, '') !~* '(@example\.(com|net|org)|\.(local|localhost|invalid|test|example))$'
        and not coalesce(ap.internal, false)
    );
$$;--> statement-breakpoint

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
    (kind, level, organization_id, org_name, user_id, title, amount_cents, test, internal, demo, data)
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
    public.admin_is_internal_org(p_org) or public.admin_is_internal_user(p_user),
    coalesce(p_demo, false),
    coalesce(p_data, '{}'::jsonb) - 'test'
  );
exception when others then
  raise warning 'admin_log(%) failed: %', p_kind, sqlerrm;
end;
$$;--> statement-breakpoint

-- Switching an account to internal (or back) re-marks what's already logged
-- about it and its shops, so its history agrees with the switch.
create or replace function public.admin_refresh_internal(p_user uuid)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_changed integer;
begin
  update public.admin_events e
  set internal = public.admin_is_internal_org(e.organization_id) or public.admin_is_internal_user(e.user_id)
  where (e.user_id = p_user
      or e.organization_id in (select m.organization_id from public.memberships m where m.user_id = p_user))
    and e.internal is distinct from (public.admin_is_internal_org(e.organization_id) or public.admin_is_internal_user(e.user_id));
  get diagnostics v_changed = row_count;
  return v_changed;
end;
$$;
