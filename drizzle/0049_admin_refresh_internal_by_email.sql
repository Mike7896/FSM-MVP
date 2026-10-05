-- Switching an account to internal also re-marks the sign-ups logged under its
-- address by an earlier copy of the account — one that was deleted and made
-- again, so its lines carry a user id that no longer exists. A sign-up line
-- keeps the address in its data; that's what it's matched on.
--
-- Rerunnable.

create or replace function public.admin_refresh_internal(p_user uuid)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_email text;
  v_internal boolean;
  v_changed integer;
begin
  select lower(email) into v_email from auth.users where id = p_user;
  v_internal := public.admin_is_internal_user(p_user);

  update public.admin_events e
  set internal = flag.internal
  from (
    select e2.id,
      public.admin_is_internal_org(e2.organization_id)
        or public.admin_is_internal_user(e2.user_id)
        or (v_internal and v_email is not null and lower(e2.data ->> 'email') = v_email) as internal
    from public.admin_events e2
    where e2.user_id = p_user
       or e2.organization_id in (select m.organization_id from public.memberships m where m.user_id = p_user)
       or (v_email is not null and lower(e2.data ->> 'email') = v_email)
  ) flag
  where e.id = flag.id and e.internal is distinct from flag.internal;
  get diagnostics v_changed = row_count;
  return v_changed;
end;
$$;
