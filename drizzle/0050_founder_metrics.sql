CREATE TABLE "mrr_changes" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"from_cents" integer NOT NULL,
	"to_cents" integer NOT NULL,
	"kind" text NOT NULL,
	"changed_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "platform_invoices" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" uuid,
	"amount_paid_cents" integer NOT NULL,
	"currency" text NOT NULL,
	"billing_reason" text,
	"paid_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "user_activity_hours" (
	"user_id" uuid NOT NULL,
	"hour" timestamp with time zone NOT NULL,
	"organization_id" uuid,
	CONSTRAINT "user_activity_hours_user_id_hour_pk" PRIMARY KEY("user_id","hour")
);
--> statement-breakpoint
ALTER TABLE "mrr_changes" ADD CONSTRAINT "mrr_changes_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "platform_invoices" ADD CONSTRAINT "platform_invoices_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_activity_hours" ADD CONSTRAINT "user_activity_hours_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "mrr_changes_changed_idx" ON "mrr_changes" USING btree ("changed_at");--> statement-breakpoint
CREATE INDEX "mrr_changes_org_idx" ON "mrr_changes" USING btree ("organization_id","changed_at");--> statement-breakpoint
CREATE INDEX "platform_invoices_paid_idx" ON "platform_invoices" USING btree ("paid_at");--> statement-breakpoint
CREATE INDEX "user_activity_hours_hour_idx" ON "user_activity_hours" USING btree ("hour");--> statement-breakpoint

-- Founder metrics: the history behind MRR movement and churn, the cash
-- ServiceClerk actually collects, and who used the app in which hour.
-- All three are read only by the admin dashboard, through the server's own
-- database connection — never through Supabase's public API.

ALTER TABLE public.mrr_changes ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE public.platform_invoices ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE public.user_activity_hours ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
REVOKE ALL ON public.mrr_changes, public.platform_invoices, public.user_activity_hours FROM anon, authenticated;--> statement-breakpoint

-- ── MRR history ────────────────────────────────────────────────────────────
-- Reconcile writes `billing_accounts.mrr_cents` from Stripe (0 when a
-- membership ends). Each change becomes one classified row. Like every
-- admin trigger, a failure here is a warning, never a failed reconcile.

create or replace function public.admin_on_mrr()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_from integer := case when tg_op = 'UPDATE' then coalesce(old.mrr_cents, 0) else 0 end;
  v_to integer := coalesce(new.mrr_cents, 0);
begin
  if v_from = v_to then
    return null;
  end if;
  insert into public.mrr_changes (organization_id, from_cents, to_cents, kind)
  values (
    new.organization_id, v_from, v_to,
    case
      when v_from = 0 and exists (
        select 1 from public.mrr_changes c where c.organization_id = new.organization_id and c.to_cents > 0
      ) then 'reactivation'
      when v_from = 0 then 'new'
      when v_to = 0 then 'churn'
      when v_to > v_from then 'expansion'
      else 'contraction'
    end
  );
  return null;
exception when others then
  raise warning 'admin_on_mrr failed: %', sqlerrm;
  return null;
end;
$$;--> statement-breakpoint

drop trigger if exists admin_on_mrr on public.billing_accounts;--> statement-breakpoint
create trigger admin_on_mrr after insert or update of mrr_cents on public.billing_accounts
  for each row execute function public.admin_on_mrr();--> statement-breakpoint

-- What every membership already brings in as tracking starts: the starting
-- point for the trend and churn, not a movement.
insert into public.mrr_changes (organization_id, from_cents, to_cents, kind)
select b.organization_id, 0, b.mrr_cents, 'baseline'
from public.billing_accounts b
where coalesce(b.mrr_cents, 0) > 0
  and not exists (select 1 from public.mrr_changes c where c.organization_id = b.organization_id);--> statement-breakpoint

-- ── Activity history ───────────────────────────────────────────────────────
-- From now the presence beacon writes it. Before now, the event log knows
-- who did something in which hour (it began 2026-09-27), and user_presence
-- knows each person's last hour.

insert into public.user_activity_hours (user_id, hour, organization_id)
select distinct on (e.user_id, date_trunc('hour', e.occurred_at))
  e.user_id, date_trunc('hour', e.occurred_at), e.organization_id
from public.admin_events e
join auth.users u on u.id = e.user_id
order by e.user_id, date_trunc('hour', e.occurred_at), e.id
on conflict do nothing;--> statement-breakpoint

insert into public.user_activity_hours (user_id, hour, organization_id)
select p.user_id, date_trunc('hour', p.last_seen), p.organization_id
from public.user_presence p
on conflict do nothing;--> statement-breakpoint

-- ── The live signal, for the new numbers ───────────────────────────────────

do $$
declare
  t text;
begin
  foreach t in array array[
    'platform_invoices', 'payment_attempts', 'billing_events', 'platform_usage', 'pack_evaluations'
  ] loop
    execute format('drop trigger if exists admin_signal on public.%I', t);
    execute format(
      'create trigger admin_signal after insert or update or delete on public.%I
         for each statement execute function public.admin_signal()', t);
  end loop;
end $$;--> statement-breakpoint

-- Per row, not per statement: the beacon tries an insert every minute, and
-- only a new hour — a row actually written — should signal.
drop trigger if exists admin_signal on public.user_activity_hours;--> statement-breakpoint
create trigger admin_signal after insert on public.user_activity_hours
  for each row execute function public.admin_signal();
