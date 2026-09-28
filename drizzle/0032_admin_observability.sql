-- The admin dashboard: a live log of what happens across every shop, who's
-- online, and who may see either.
--
-- **Events are written by the database, not by the app.** A trigger on each
-- table that matters (signups, subscriptions, sends, payments…) appends a row
-- to admin_events, so no code path — a webhook, a script, a future mobile API —
-- can do something important without it showing up. Supabase Realtime streams
-- the inserts to the dashboard; RLS means only platform admins receive them.
--
-- **Observability never breaks the thing it observes.** Every trigger swallows
-- its own errors: a failed log line is a warning in the Postgres log, never a
-- failed signup or a lost payment.

-- ── Who may see it ─────────────────────────────────────────────────────────

CREATE TABLE "platform_admins" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"email" text NOT NULL,
	"added_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
ALTER TABLE "platform_admins" ADD CONSTRAINT "platform_admins_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
alter table public.platform_admins enable row level security;--> statement-breakpoint
create policy "platform_admins: self read"
  on public.platform_admins for select to authenticated
  using (user_id = auth.uid());--> statement-breakpoint

create or replace function public.is_platform_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (select 1 from public.platform_admins where user_id = auth.uid());
$$;--> statement-breakpoint

-- ── The log ────────────────────────────────────────────────────────────────

CREATE TABLE "admin_events" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	"kind" text NOT NULL,
	"level" text NOT NULL,
	"organization_id" uuid,
	"org_name" text,
	"user_id" uuid,
	"title" text NOT NULL,
	"amount_cents" bigint,
	"test" boolean DEFAULT false NOT NULL,
	"demo" boolean DEFAULT false NOT NULL,
	"data" jsonb DEFAULT '{}'::jsonb NOT NULL,
	CONSTRAINT "admin_events_level_check" CHECK ("admin_events"."level" in ('money', 'milestone', 'activity', 'problem'))
);--> statement-breakpoint
CREATE INDEX "admin_events_occurred_idx" ON "admin_events" USING btree ("occurred_at" desc);--> statement-breakpoint
CREATE INDEX "admin_events_kind_idx" ON "admin_events" USING btree ("kind","occurred_at" desc);--> statement-breakpoint
alter table public.admin_events enable row level security;--> statement-breakpoint
create policy "admin_events: platform admins read"
  on public.admin_events for select to authenticated
  using (public.is_platform_admin());--> statement-breakpoint

-- ── Who's online ───────────────────────────────────────────────────────────
-- One row per person, touched about once a minute while the app is open. Only
-- the area of the app (quotes, schedule…) — never the page, never a record.

CREATE TABLE "user_presence" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid,
	"area" text NOT NULL,
	"device" text,
	"last_seen" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
ALTER TABLE "user_presence" ADD CONSTRAINT "user_presence_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "user_presence_last_seen_idx" ON "user_presence" USING btree ("last_seen" desc);--> statement-breakpoint
alter table public.user_presence enable row level security;--> statement-breakpoint
create policy "user_presence: platform admins read"
  on public.user_presence for select to authenticated
  using (public.is_platform_admin());--> statement-breakpoint

alter publication supabase_realtime add table public.admin_events, public.user_presence;--> statement-breakpoint

-- ── Writing a line ─────────────────────────────────────────────────────────

create or replace function public.admin_money(cents bigint)
returns text
language sql
immutable
as $$
  select to_char(coalesce(cents, 0) / 100.0, 'FM$999,999,990.00');
$$;--> statement-breakpoint

-- `{org}` in the title becomes the business's name. A shop made by one of the
-- check scripts (slug "…-check-…") is marked test, so the dashboard can hide it.
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
    coalesce(v_slug ~ '(^|-)check-', false),
    coalesce(p_demo, false),
    coalesce(p_data, '{}'::jsonb)
  );
exception when others then
  raise warning 'admin_log(%) failed: %', p_kind, sqlerrm;
end;
$$;--> statement-breakpoint

-- ── Signups and sign-ins ───────────────────────────────────────────────────

create or replace function public.admin_on_profile()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  perform public.admin_log(
    'signup', 'milestone', null, new.id,
    coalesce(nullif(btrim(new.full_name), ''), new.email) || ' signed up',
    null, false,
    jsonb_build_object('email', new.email, 'trade', new.trade)
  );
  return new;
exception when others then
  raise warning 'admin_on_profile failed: %', sqlerrm;
  return new;
end;
$$;--> statement-breakpoint
create trigger admin_on_profile after insert on public.profiles
  for each row execute function public.admin_on_profile();--> statement-breakpoint

create or replace function public.admin_on_session()
returns trigger language plpgsql security definer set search_path = public, auth as $$
declare
  v_email text;
  v_org uuid;
begin
  select email into v_email from public.profiles where id = new.user_id;
  select organization_id into v_org from public.memberships where user_id = new.user_id
    order by created_at limit 1;
  perform public.admin_log(
    'signin', 'activity', v_org, new.user_id,
    coalesce(v_email, 'Someone') || ' signed in',
    null, false,
    jsonb_build_object('device', case when new.user_agent ~* 'mobile|android|iphone' then 'phone' else 'computer' end)
  );
  return new;
exception when others then
  raise warning 'admin_on_session failed: %', sqlerrm;
  return new;
end;
$$;--> statement-breakpoint
do $$
begin
  create trigger admin_on_session after insert on auth.sessions
    for each row execute function public.admin_on_session();
exception when insufficient_privilege then
  raise notice 'No trigger on auth.sessions — sign-ins will not be logged.';
end;
$$;--> statement-breakpoint

create or replace function public.admin_on_organization()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  perform public.admin_log(
    'business.created', 'milestone', new.id, new.created_by,
    '{org} set up their business', null, false,
    jsonb_build_object('trade', new.trade)
  );
  return new;
exception when others then
  raise warning 'admin_on_organization failed: %', sqlerrm;
  return new;
end;
$$;--> statement-breakpoint
create trigger admin_on_organization after insert on public.organizations
  for each row execute function public.admin_on_organization();--> statement-breakpoint

-- ── Subscriptions: trials, purchases, cancellations ───────────────────────

create or replace function public.admin_on_subscription()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_amount bigint;
  v_interval text;
  v_plan text;
  v_per text;
  v_old text := case when tg_op = 'UPDATE' then old.status::text else null end;
  v_data jsonb;
begin
  select p.unit_amount * coalesce(new.quantity, 1), p.interval::text, pr.name
    into v_amount, v_interval, v_plan
    from public.prices p left join public.products pr on pr.id = p.product_id
    where p.id = new.price_id;
  v_per := case v_interval when 'year' then '/year' when 'month' then '/month' else '' end;
  v_data := jsonb_build_object('subscription', new.id, 'plan', v_plan, 'interval', v_interval, 'from', v_old, 'to', new.status);

  if new.status = 'trialing' and v_old is distinct from 'trialing' then
    perform public.admin_log('trial.started', 'milestone', new.organization_id, null,
      '{org} started a free trial' || coalesce(' of ' || v_plan, ''), v_amount, false, v_data);
  end if;

  if new.status = 'active' and v_old is distinct from 'active' then
    perform public.admin_log('subscription.started', 'money', new.organization_id, null,
      '{org} ' || case when v_old = 'trialing' then 'turned their trial into ' else 'bought ' end
        || coalesce(v_plan, 'a plan') || ' — ' || public.admin_money(v_amount) || v_per,
      v_amount, false, v_data);
  end if;

  if new.status = 'canceled' and v_old is distinct from 'canceled' and tg_op = 'UPDATE' then
    perform public.admin_log('subscription.canceled', 'problem', new.organization_id, null,
      '{org} canceled' || coalesce(' ' || v_plan, ''), v_amount, false, v_data);
  end if;

  if new.status in ('past_due', 'unpaid') and v_old is distinct from new.status::text then
    perform public.admin_log('subscription.past_due', 'problem', new.organization_id, null,
      '{org}''s payment failed — ' || new.status, v_amount, false, v_data);
  end if;

  if tg_op = 'UPDATE' and new.cancel_at_period_end and not old.cancel_at_period_end then
    perform public.admin_log('subscription.cancel_scheduled', 'problem', new.organization_id, null,
      '{org} set their plan to end' || coalesce(' on ' || to_char(new.current_period_end, 'Mon DD'), ''),
      v_amount, false, v_data);
  end if;

  if tg_op = 'UPDATE' and not new.cancel_at_period_end and old.cancel_at_period_end
     and new.status in ('active', 'trialing') then
    perform public.admin_log('subscription.resumed', 'milestone', new.organization_id, null,
      '{org} changed their mind and kept their plan', v_amount, false, v_data);
  end if;

  return new;
exception when others then
  raise warning 'admin_on_subscription failed: %', sqlerrm;
  return new;
end;
$$;--> statement-breakpoint
create trigger admin_on_subscription after insert or update of status, cancel_at_period_end on public.subscriptions
  for each row execute function public.admin_on_subscription();--> statement-breakpoint

-- ── Documents: started, sent, opened, accepted, signed ────────────────────

create or replace function public.admin_on_document()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_demo boolean;
  v_label text;
  v_accepted int;
begin
  select coalesce(is_demo, false) into v_demo from public.jobs where id = new.job_id;
  v_label := coalesce(new.number, 'a ' || replace(new.type::text, '_', ' '));

  if tg_op = 'INSERT' then
    if new.type = 'quote' then
      perform public.admin_log('quote.created', 'activity', new.organization_id, new.created_by,
        '{org} started quote ' || v_label, null, v_demo, jsonb_build_object('document', new.id));
    end if;
    return new;
  end if;

  if new.status is not distinct from old.status then
    return new;
  end if;

  if new.type = 'quote' and new.status = 'accepted' then
    select count(*) into v_accepted from public.documents d
      join public.jobs j on j.id = d.job_id
      where d.organization_id = new.organization_id and d.type = 'quote'
        and d.status = 'accepted' and not j.is_demo;
    perform public.admin_log('quote.accepted', 'milestone', new.organization_id, null,
      case when v_accepted = 1 and not v_demo
        then '{org} won their first job — quote ' || v_label || ' approved'
        else '{org}''s customer approved quote ' || v_label end,
      null, v_demo, jsonb_build_object('document', new.id, 'nth', v_accepted));
  elsif new.type = 'quote' and new.status = 'declined' then
    perform public.admin_log('quote.declined', 'activity', new.organization_id, null,
      '{org}''s customer declined quote ' || v_label, null, v_demo, jsonb_build_object('document', new.id));
  elsif new.type = 'contract' and new.status = 'signed' then
    perform public.admin_log('contract.signed', 'milestone', new.organization_id, null,
      '{org} has a signed contract ' || v_label, null, v_demo, jsonb_build_object('document', new.id));
  elsif new.type = 'change_order' and new.status = 'approved' then
    perform public.admin_log('change_order.approved', 'activity', new.organization_id, null,
      '{org}''s customer approved change order ' || v_label, null, v_demo, jsonb_build_object('document', new.id));
  end if;
  return new;
exception when others then
  raise warning 'admin_on_document failed: %', sqlerrm;
  return new;
end;
$$;--> statement-breakpoint
create trigger admin_on_document after insert or update of status on public.documents
  for each row execute function public.admin_on_document();--> statement-breakpoint

create or replace function public.admin_on_send()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_type text;
  v_number text;
  v_demo boolean;
  v_count int;
  v_level text := 'activity';
  v_title text;
begin
  select d.type::text, d.number, coalesce(j.is_demo, false)
    into v_type, v_number, v_demo
    from public.documents d left join public.jobs j on j.id = d.job_id
    where d.id = new.document_id;

  v_title := '{org} sent ' || replace(v_type, '_', ' ') || ' ' || coalesce(v_number, '')
    || case when new.channel = 'email' then ' by email' when new.channel = 'link' then ' as a link' else '' end;

  -- Milestones in how many quotes a shop has sent: the first, then 5, 10, 25…
  if v_type = 'quote' and not v_demo then
    select count(distinct s.document_id) into v_count
      from public.document_sends s
      join public.documents d on d.id = s.document_id
      join public.jobs j on j.id = d.job_id
      where s.organization_id = new.organization_id and d.type = 'quote' and not j.is_demo;
    if v_count in (1, 5, 10, 25, 50, 100, 250, 500, 1000) and not exists (
      select 1 from public.document_sends s2
        where s2.document_id = new.document_id and s2.id <> new.id
    ) then
      v_level := 'milestone';
      v_title := case when v_count = 1 then '{org} sent their first quote'
        else '{org} just sent their ' || v_count || 'th quote' end;
    end if;
  end if;

  perform public.admin_log(coalesce(v_type, 'document') || '.sent', v_level, new.organization_id, new.sent_by,
    v_title, null, v_demo,
    jsonb_build_object('document', new.document_id, 'channel', new.channel, 'quotes_sent', v_count));
  return new;
exception when others then
  raise warning 'admin_on_send failed: %', sqlerrm;
  return new;
end;
$$;--> statement-breakpoint
create trigger admin_on_send after insert on public.document_sends
  for each row execute function public.admin_on_send();--> statement-breakpoint

-- The first time a customer opens a link — the moment the quote lands.
create or replace function public.admin_on_view()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_org uuid;
  v_type text;
  v_number text;
  v_demo boolean;
begin
  if exists (select 1 from public.share_link_views
             where share_link_id = new.share_link_id and id <> new.id) then
    return new;
  end if;
  select d.organization_id, d.type::text, d.number, coalesce(j.is_demo, false)
    into v_org, v_type, v_number, v_demo
    from public.share_links l
    join public.documents d on d.id = l.document_id
    left join public.jobs j on j.id = d.job_id
    where l.id = new.share_link_id;
  if v_org is null then return new; end if;
  perform public.admin_log(v_type || '.opened', 'activity', v_org, null,
    '{org}''s customer opened ' || replace(v_type, '_', ' ') || ' ' || coalesce(v_number, ''),
    null, v_demo, jsonb_build_object('share_link', new.share_link_id));
  return new;
exception when others then
  raise warning 'admin_on_view failed: %', sqlerrm;
  return new;
end;
$$;--> statement-breakpoint
create trigger admin_on_view after insert on public.share_link_views
  for each row execute function public.admin_on_view();--> statement-breakpoint

-- ── Money through the app ──────────────────────────────────────────────────

create or replace function public.admin_on_ledger()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_demo boolean;
begin
  if new.entry_type not in ('payment_received', 'refund_issued', 'chargeback_opened') then
    return new;
  end if;
  select coalesce(is_demo, false) into v_demo from public.jobs where id = new.job_id;
  if new.entry_type = 'payment_received' then
    perform public.admin_log('payment.received', 'money', new.organization_id, new.created_by,
      '{org} got paid ' || public.admin_money(new.amount_cents)
        || case when new.source = 'stripe' then ' by card' else ' (recorded)' end,
      new.amount_cents, v_demo,
      jsonb_build_object('source', new.source, 'method', new.method, 'invoice', new.invoice_id));
  else
    perform public.admin_log('payment.' || new.entry_type, 'problem', new.organization_id, new.created_by,
      '{org}: ' || replace(new.entry_type::text, '_', ' ') || ' ' || public.admin_money(abs(new.amount_cents)),
      new.amount_cents, v_demo, jsonb_build_object('source', new.source));
  end if;
  return new;
exception when others then
  raise warning 'admin_on_ledger failed: %', sqlerrm;
  return new;
end;
$$;--> statement-breakpoint
create trigger admin_on_ledger after insert on public.ledger_entries
  for each row execute function public.admin_on_ledger();--> statement-breakpoint

create or replace function public.admin_on_connected_account()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.status = 'active' and (tg_op = 'INSERT' or old.status is distinct from 'active') then
    perform public.admin_log('card_payments.connected', 'milestone', new.organization_id, null,
      '{org} can take card payments now', null, false, '{}'::jsonb);
  elsif tg_op = 'UPDATE' and new.status = 'restricted' and old.status is distinct from 'restricted' then
    perform public.admin_log('card_payments.restricted', 'problem', new.organization_id, null,
      '{org}''s card payments were restricted by Stripe', null, false,
      jsonb_build_object('reason', new.disabled_reason));
  end if;
  return new;
exception when others then
  raise warning 'admin_on_connected_account failed: %', sqlerrm;
  return new;
end;
$$;--> statement-breakpoint
create trigger admin_on_connected_account after insert or update of status on public.connected_accounts
  for each row execute function public.admin_on_connected_account();--> statement-breakpoint

-- ── Everyday use ───────────────────────────────────────────────────────────

create or replace function public.admin_on_usage()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_table_name = 'jobs' then
    perform public.admin_log('job.created', 'activity', new.organization_id, new.created_by,
      '{org} opened job #' || new.number, null, coalesce(new.is_demo, false), '{}'::jsonb);
  elsif tg_table_name = 'visits' then
    perform public.admin_log('visit.booked', 'activity', new.organization_id, new.created_by,
      '{org} booked a visit on the schedule', null, false, jsonb_build_object('kind', new.kind));
  elsif tg_table_name = 'tasks' then
    perform public.admin_log('task.created', 'activity', new.organization_id, new.created_by,
      '{org} added a task', null, false, '{}'::jsonb);
  end if;
  return new;
exception when others then
  raise warning 'admin_on_usage failed: %', sqlerrm;
  return new;
end;
$$;--> statement-breakpoint
create trigger admin_on_job after insert on public.jobs
  for each row execute function public.admin_on_usage();--> statement-breakpoint
create trigger admin_on_visit after insert on public.visits
  for each row execute function public.admin_on_usage();--> statement-breakpoint
create trigger admin_on_task after insert on public.tasks
  for each row execute function public.admin_on_usage();--> statement-breakpoint

-- ── Things going wrong ─────────────────────────────────────────────────────

create or replace function public.admin_on_support()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  perform public.admin_log('support.' || new.kind, case new.kind when 'idea' then 'activity' else 'problem' end,
    new.organization_id, new.user_id,
    case new.kind when 'bug' then 'Problem reported' when 'idea' then 'Feature idea' else 'Help wanted' end
      || ' #' || new.number || ': ' || new.subject,
    null, false, jsonb_build_object('request', new.id, 'page', new.page, 'from', new.reply_to));
  return new;
exception when others then
  raise warning 'admin_on_support failed: %', sqlerrm;
  return new;
end;
$$;--> statement-breakpoint
create trigger admin_on_support after insert on public.support_requests
  for each row execute function public.admin_on_support();--> statement-breakpoint

create or replace function public.admin_on_delivery()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_org uuid;
  v_kind text;
begin
  if new.status <> 'failed' or old.status = 'failed' then return new; end if;
  select organization_id, kind into v_org, v_kind from public.notifications where id = new.notification_id;
  perform public.admin_log('delivery.failed', 'problem', v_org, null,
    'A ' || new.channel || ' to ' || coalesce(new.recipient, 'someone') || ' failed'
      || coalesce(': ' || left(new.last_error, 140), ''),
    null, false, jsonb_build_object('notification', v_kind, 'attempts', new.attempts));
  return new;
exception when others then
  raise warning 'admin_on_delivery failed: %', sqlerrm;
  return new;
end;
$$;--> statement-breakpoint
create trigger admin_on_delivery after update of status on public.notification_deliveries
  for each row execute function public.admin_on_delivery();
