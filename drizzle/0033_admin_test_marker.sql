-- A log line can be marked test by what wrote it, not only by which shop it's
-- in: a check script's support request with no shop at all ("user_agent" ends
-- in "-check") would otherwise stream to the live dashboard as real news.

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
  v_slug text;
begin
  if p_org is not null then
    select name, slug into v_name, v_slug from public.organizations where id = p_org;
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
    coalesce(v_slug ~ '(^|-)check-', false) or coalesce((p_data ->> 'test')::boolean, false),
    coalesce(p_demo, false),
    coalesce(p_data, '{}'::jsonb) - 'test'
  );
exception when others then
  raise warning 'admin_log(%) failed: %', p_kind, sqlerrm;
end;
$$;--> statement-breakpoint

create or replace function public.admin_on_support()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  perform public.admin_log('support.' || new.kind, case new.kind when 'idea' then 'activity' else 'problem' end,
    new.organization_id, new.user_id,
    case new.kind when 'bug' then 'Problem reported' when 'idea' then 'Feature idea' else 'Help wanted' end
      || ' #' || new.number || ': ' || new.subject,
    null, false,
    jsonb_build_object('request', new.id, 'page', new.page, 'from', new.reply_to,
      'test', coalesce(new.user_agent like '%-check', false)));
  return new;
exception when others then
  raise warning 'admin_on_support failed: %', sqlerrm;
  return new;
end;
$$;
