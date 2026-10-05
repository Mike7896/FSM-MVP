-- A shop nobody is in is a test.
--
-- Nobody can sign in to a shop with no members, so it isn't a business anyone
-- runs: it's a check script's fixture, or a leftover from early development.
-- The rule from drizzle/0046 becomes one condition — a shop is test when its
-- address says "check-", or it has no member who's a real person — which
-- covers an empty shop and a shop of test accounts alike.
--
-- **"Set up their business" now waits for the commit.** The app creates a shop
-- and its owner in one transaction (app/api/v1/organizations), but the row
-- trigger used to fire between the two, when every new shop was empty. As a
-- deferred trigger it runs at commit, when the owner is there to be seen. A
-- shop created and deleted in the same transaction is never logged.
--
-- Rerunnable.

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
        or not exists (
          select 1 from public.memberships m
          join auth.users u on u.id = m.user_id
          where m.organization_id = o.id
            and coalesce(u.email, '') !~* '(@example\.(com|net|org)|\.(local|localhost|invalid|test|example))$'
        )
      )
  );
$$;--> statement-breakpoint

create or replace function public.admin_on_organization()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from public.organizations where id = new.id) then
    return null;
  end if;
  perform public.admin_log(
    'business.created', 'milestone', new.id, new.created_by,
    '{org} set up their business', null, false,
    jsonb_build_object('trade', new.trade)
  );
  return null;
exception when others then
  raise warning 'admin_on_organization failed: %', sqlerrm;
  return null;
end;
$$;--> statement-breakpoint

drop trigger if exists admin_on_organization on public.organizations;--> statement-breakpoint
create constraint trigger admin_on_organization after insert on public.organizations
  deferrable initially deferred
  for each row execute function public.admin_on_organization();--> statement-breakpoint

-- The lines already written for shops that are test by this rule.
update public.admin_events e
set test = true
where not e.test and public.admin_is_test_org(e.organization_id);
