import "server-only";

import { sql, type SQL } from "drizzle-orm";

import { db } from "@/lib/db";
import { serverEnv } from "@/lib/env";

import { COUNTED, REAL_ORG, realUser } from "./counting";
import { getFounderMetrics } from "./founder-metrics";

/**
 * Every number on the admin dashboard, in one read.
 *
 * **Counted from the source tables, not from the event log.** The log starts
 * the day it was switched on and only knows what its triggers saw; profiles,
 * subscriptions, sends and the ledger know everything. The log is for what's
 * happening now — the feed, the hourly pulse, "last seen".
 *
 * **Test, internal and demo never count.** What's a test (the check scripts'
 * made-up data) and what's internal (the team's own accounts and shops) is
 * decided in the database — `admin_is_test_org`/`_user` and
 * `admin_is_internal_org`/`_user` (drizzle/0046–0048) — by the same functions
 * the event log asks as it writes, so the feed and these numbers can't
 * disagree. Testers made from the panel are left out of the people counts too
 * (`realUser`). Demo work is left out of every business and activity number —
 * the same rule the product's own dashboard keeps.
 *
 * Days are cut on the viewer's clock (`timeZone`), because "today" on a Friday
 * night in Ohio is not today in UTC.
 */

export { realUser };

export type AdminMetrics = Awaited<ReturnType<typeof getAdminMetrics>>;

export async function getAdminMetrics(timeZone: string) {
  const tz = timeZone;
  const today = sql`(date_trunc('day', now() at time zone ${tz}) at time zone ${tz})`;

  const [
    people,
    revenueRows,
    trialsEnding,
    usage,
    money,
    funnel,
    series,
    hourly,
    byKind,
    newest,
    active,
    testUsers,
    support,
    deliveries,
    failures,
    stripe,
    tables,
    dbInfo,
  ] = await inOrder([
    () => one(sql`
      select
        (select count(*) from profiles p where ${realUser(sql`p.id`)})::int as users,
        (select count(*) from profiles p where ${realUser(sql`p.id`)} and created_at >= ${today})::int as signups_today,
        (select count(*) from profiles p where ${realUser(sql`p.id`)} and created_at >= now() - interval '7 days')::int as signups_7d,
        (select count(*) from profiles p where ${realUser(sql`p.id`)} and created_at >= now() - interval '30 days')::int as signups_30d,
        (select count(*) from organizations o where ${REAL_ORG})::int as businesses,
        (select count(*) from organizations o where ${REAL_ORG} and created_at >= ${today})::int as businesses_today,
        (select count(*) from organizations o where ${REAL_ORG} and created_at >= now() - interval '7 days')::int as businesses_7d,
        (select count(distinct e.user_id) from admin_events e
          where e.kind = 'signin' and not e.test and e.occurred_at >= ${today} and ${realUser(sql`e.user_id`)})::int as signed_in_today,
        -- Sign-ins are logged by a trigger on auth.sessions, which a database
        -- without the privilege skips at migration time — then there are none.
        exists (select 1 from pg_trigger where tgname = 'admin_on_session' and not tgisinternal) as signins_logged,
        -- Who's had the app open (now, today, 24h, 7d) isn't counted here: the
        -- dashboard counts it from the presence rows Realtime streams to it,
        -- so it moves the moment somebody opens the app.
        (select count(*) from admin_events where ${COUNTED} and occurred_at > now() - interval '1 hour')::int as events_hour,
        (select count(*) from admin_events where ${COUNTED} and occurred_at >= ${today})::int as events_today,
        (select count(*) from support_requests where status = 'open')::int as support_open,
        (select min(occurred_at) from admin_events) as log_since
    `),

    // MRR is what reconcile read from Stripe — every line, less discounts.
    // A membership not reconciled since that was recorded falls back to the
    // list prices of all its lines (packs too), then to the core line alone.
    // mrr_cents is read through to_jsonb so a database without drizzle/0041
    // gets the fallback rather than an error.
    () => many(sql`
      select s.status::text as status, coalesce(pr.name, 'Unknown plan') as plan, count(*)::int as count,
        coalesce(sum(coalesce(
          (to_jsonb(ba) ->> 'mrr_cents')::bigint,
          (select sum(${monthly(sql`lp`, sql`1`)}) from prices lp where lp.lookup_key = any(ba.price_keys)),
          ${monthly(sql`p`, sql`coalesce(s.quantity, 1)`)}
        )), 0)::bigint as mrr_cents,
        count(*) filter (where to_jsonb(ba) ->> 'mrr_cents' is null)::int as estimated
      from subscriptions s
      join organizations o on o.id = s.organization_id
      left join billing_accounts ba on ba.subscription_id = s.id
      left join prices p on p.id = s.price_id
      left join products pr on pr.id = p.product_id
      where ${REAL_ORG}
      group by 1, 2
      order by 3 desc
    `),

    () => many(sql`
      select o.name, s.trial_end
      from subscriptions s join organizations o on o.id = s.organization_id
      where ${REAL_ORG} and s.status = 'trialing' and s.trial_end between now() and now() + interval '7 days'
      order by s.trial_end
    `),

    () => one(sql`
      with q as (
        select d.id, d.created_at, d.status, d.updated_at
        from documents d join jobs j on j.id = d.job_id join organizations o on o.id = d.organization_id
        where d.type = 'quote' and not j.is_demo and ${REAL_ORG}
      ),
      sends as (
        select distinct on (s.document_id) s.document_id, s.sent_at
        from document_sends s join documents d on d.id = s.document_id
        join jobs j on j.id = d.job_id join organizations o on o.id = d.organization_id
        where d.type = 'quote' and not j.is_demo and ${REAL_ORG}
        order by s.document_id, s.sent_at
      )
      select
        (select count(*) from q)::int as quotes_all,
        (select count(*) from q where created_at >= ${today})::int as quotes_today,
        (select count(*) from q where created_at >= now() - interval '7 days')::int as quotes_7d,
        (select count(*) from q where created_at >= now() - interval '30 days')::int as quotes_30d,
        (select count(*) from sends)::int as sent_all,
        (select count(*) from sends where sent_at >= ${today})::int as sent_today,
        (select count(*) from sends where sent_at >= now() - interval '7 days')::int as sent_7d,
        (select count(*) from sends where sent_at >= now() - interval '30 days')::int as sent_30d,
        (select count(*) from q where status = 'accepted')::int as accepted_all,
        (select count(*) from q where status = 'accepted' and updated_at >= ${today})::int as accepted_today,
        (select count(*) from q where status = 'accepted' and updated_at >= now() - interval '7 days')::int as accepted_7d,
        (select count(*) from q where status = 'accepted' and updated_at >= now() - interval '30 days')::int as accepted_30d,
        (select count(*) from q where status in ('viewed', 'accepted', 'declined'))::int as opened_all,
        (select count(*) from documents d join jobs j on j.id = d.job_id where d.type = 'quote' and j.is_demo and d.created_at >= now() - interval '7 days')::int as demo_quotes_7d,
        (select count(*) from jobs j join organizations o on o.id = j.organization_id where not j.is_demo and ${REAL_ORG} and j.created_at >= now() - interval '7 days')::int as jobs_7d,
        (select count(*) from visits v join organizations o on o.id = v.organization_id where ${REAL_ORG} and v.created_at >= now() - interval '7 days')::int as visits_7d,
        (select count(*) from tasks t join organizations o on o.id = t.organization_id where ${REAL_ORG} and t.created_at >= now() - interval '7 days')::int as tasks_7d,
        (select count(*) from documents d join organizations o on o.id = d.organization_id where d.type = 'invoice' and ${REAL_ORG} and d.created_at >= now() - interval '30 days')::int as invoices_30d,
        (select count(*) from documents d join organizations o on o.id = d.organization_id where d.type = 'change_order' and ${REAL_ORG} and d.created_at >= now() - interval '30 days')::int as change_orders_30d
    `),

    () => one(sql`
      with pay as (
        select l.amount_cents, l.occurred_at, l.source
        from ledger_entries l join organizations o on o.id = l.organization_id
        left join jobs j on j.id = l.job_id
        where l.entry_type = 'payment_received' and not coalesce(j.is_demo, false) and ${REAL_ORG}
      )
      select
        coalesce((select sum(amount_cents) from pay where occurred_at >= ${today}), 0)::bigint as today,
        coalesce((select sum(amount_cents) from pay where occurred_at >= now() - interval '7 days'), 0)::bigint as week,
        coalesce((select sum(amount_cents) from pay where occurred_at >= now() - interval '30 days'), 0)::bigint as month,
        coalesce((select sum(amount_cents) from pay), 0)::bigint as all_time,
        (select count(*) from pay where occurred_at >= now() - interval '30 days')::int as count_30d,
        coalesce((select sum(amount_cents) from pay where source = 'stripe' and occurred_at >= now() - interval '30 days'), 0)::bigint as card_30d,
        (select count(*) from connected_accounts ca join organizations o on o.id = ca.organization_id where ca.status = 'active' and ${REAL_ORG})::int as card_enabled
    `),

    () => one(sql`
      with orgs as (
        select o.id from organizations o where ${REAL_ORG} and o.created_at >= now() - interval '90 days'
      )
      select
        (select count(*) from profiles p where ${realUser(sql`p.id`)} and created_at >= now() - interval '90 days')::int as signed_up,
        (select count(*) from orgs)::int as business,
        (select count(distinct d.organization_id) from documents d join jobs j on j.id = d.job_id
          where d.type = 'quote' and not j.is_demo and d.organization_id in (select id from orgs))::int as quoted,
        (select count(distinct s.organization_id) from document_sends s join documents d on d.id = s.document_id
          join jobs j on j.id = d.job_id
          where d.type = 'quote' and not j.is_demo and s.organization_id in (select id from orgs))::int as sent,
        (select count(distinct d.organization_id) from documents d join jobs j on j.id = d.job_id
          where d.type = 'quote' and d.status = 'accepted' and not j.is_demo and d.organization_id in (select id from orgs))::int as won,
        (select count(*) from connected_accounts where status = 'active' and organization_id in (select id from orgs))::int as card,
        (select count(distinct organization_id) from subscriptions
          where status in ('active', 'trialing', 'past_due') and organization_id in (select id from orgs))::int as subscribed,
        (select count(distinct organization_id) from subscriptions
          where status = 'active' and organization_id in (select id from orgs))::int as paying
    `),

    () => many(sql`
      with days as (
        select generate_series(
          (date_trunc('day', now() at time zone ${tz}) - interval '29 days')::date,
          (date_trunc('day', now() at time zone ${tz}))::date,
          interval '1 day'
        )::date as day
      )
      select to_char(d.day, 'YYYY-MM-DD') as day,
        (select count(*) from profiles p where ${realUser(sql`p.id`)} and (p.created_at at time zone ${tz})::date = d.day)::int as signups,
        (select count(*) from organizations o where ${REAL_ORG} and (o.created_at at time zone ${tz})::date = d.day)::int as businesses,
        (select count(distinct s.document_id) from document_sends s
          join documents doc on doc.id = s.document_id join jobs j on j.id = doc.job_id
          join organizations o on o.id = s.organization_id
          where doc.type = 'quote' and not j.is_demo and ${REAL_ORG}
            and (s.sent_at at time zone ${tz})::date = d.day)::int as sent,
        (select coalesce(sum(l.amount_cents), 0) from ledger_entries l
          join organizations o on o.id = l.organization_id left join jobs j on j.id = l.job_id
          where l.entry_type = 'payment_received' and not coalesce(j.is_demo, false) and ${REAL_ORG}
            and (l.occurred_at at time zone ${tz})::date = d.day)::bigint as collected,
        (select count(*) from admin_events e where ${COUNTED} and (e.occurred_at at time zone ${tz})::date = d.day)::int as events
      from days d
      order by d.day
    `),

    () => many(sql`
      with hours as (
        select generate_series(date_trunc('hour', now()) - interval '23 hours', date_trunc('hour', now()), interval '1 hour') as hour
      )
      select h.hour,
        (select count(*) from admin_events e where ${COUNTED} and e.occurred_at >= h.hour and e.occurred_at < h.hour + interval '1 hour')::int as events,
        (select count(*) from admin_events e where ${COUNTED} and e.level in ('money', 'milestone') and e.occurred_at >= h.hour and e.occurred_at < h.hour + interval '1 hour')::int as big
      from hours h order by h.hour
    `),

    () => many(sql`
      select kind, level, count(*)::int as count
      from admin_events where ${COUNTED} and occurred_at > now() - interval '24 hours'
      group by 1, 2 order by 3 desc
    `),

    () => many(sql`
      select o.id, o.name, o.trade, o.created_at,
        (select p.email from memberships m join profiles p on p.id = m.user_id
          where m.organization_id = o.id order by (m.role = 'owner') desc, m.created_at limit 1) as owner,
        (select count(*) from memberships m where m.organization_id = o.id)::int as people,
        (select count(distinct s.document_id) from document_sends s join documents d on d.id = s.document_id
          join jobs j on j.id = d.job_id
          where s.organization_id = o.id and d.type = 'quote' and not j.is_demo)::int as quotes_sent,
        (select count(*) from documents d join jobs j on j.id = d.job_id
          where d.organization_id = o.id and d.type = 'quote' and d.status = 'accepted' and not j.is_demo)::int as won,
        (select coalesce(sum(l.amount_cents), 0) from ledger_entries l left join jobs j on j.id = l.job_id
          where l.organization_id = o.id and l.entry_type = 'payment_received' and not coalesce(j.is_demo, false))::bigint as collected,
        coalesce(
          (select s.status::text from subscriptions s where s.organization_id = o.id order by s.created_at desc limit 1),
          -- A complimentary plan is set on the owner from the admin panel, as membership access reads it.
          (select 'complimentary' from memberships m join account_policies ap on ap.user_id = m.user_id
            where m.organization_id = o.id and m.role = 'owner' and ap.comp_plan
              and (ap.access_until is null or ap.access_until >= current_date) limit 1)
        ) as plan,
        (select max(up.last_seen) from user_presence up where up.organization_id = o.id) as last_seen,
        (select max(e.occurred_at) from admin_events e where e.organization_id = o.id) as last_event
      from organizations o
      where ${REAL_ORG}
      order by o.created_at desc
      limit 25
    `),

    () => many(sql`
      select coalesce(org_name, 'No business') as name, organization_id, count(*)::int as events,
        count(*) filter (where level in ('money', 'milestone'))::int as big,
        max(occurred_at) as last
      from admin_events
      where ${COUNTED} and occurred_at > now() - interval '7 days'
      group by 1, 2 order by 3 desc limit 10
    `),

    // Who the live presence feed should leave out — it arrives over Realtime
    // unfiltered, so the browser drops these.
    () => many(sql`select p.id from profiles p where not ${realUser(sql`p.id`)} limit 5000`),

    () => many(sql`
      select r.id, r.number, r.kind::text as kind, r.subject, r.body, r.status::text as status, r.page,
        r.reply_to, r.created_at, r.emailed_at, r.sentry_event_id,
        o.name as business, p.full_name as name
      from support_requests r
      left join organizations o on o.id = r.organization_id
      left join profiles p on p.id = r.user_id
      order by (r.status = 'open') desc, r.created_at desc
      limit 30
    `),

    () => many(sql`
      select channel, status, count(*)::int as count
      from notification_deliveries
      where created_at > now() - interval '24 hours'
      group by 1, 2 order by 1, 2
    `),

    () => many(sql`
      select d.channel, d.recipient, d.last_error, d.attempts, d.updated_at, n.kind
      from notification_deliveries d left join notifications n on n.id = d.notification_id
      where d.status = 'failed'
      order by d.updated_at desc limit 10
    `),

    () => many(sql`select id, type, processed_at from stripe_events order by processed_at desc nulls last limit 15`),

    () => many(sql`
      select relname as name, n_live_tup::bigint as rows
      from pg_stat_user_tables where schemaname = 'public'
      order by n_live_tup desc limit 24
    `),

    () => one(sql`
      select pg_size_pretty(pg_database_size(current_database())) as size,
        (select count(*) from drizzle.__drizzle_migrations)::int as migrations,
        (select string_agg(tablename, ', ') from pg_publication_tables where pubname = 'supabase_realtime') as realtime,
        (select count(*) from admin_events)::int as events_logged,
        (select count(*) from platform_admins)::int as admins,
        now() as db_time
    `),
  ]);

  const revenue = revenueRows.map((row) => ({
    status: String(row.status),
    plan: String(row.plan),
    count: Number(row.count),
    mrrCents: Number(row.mrr_cents),
    estimated: Number(row.estimated),
  }));
  const paying = revenue.filter((row) => row.status === "active");
  const mrrCents = paying.reduce((sum, row) => sum + row.mrrCents, 0);
  const payingCount = paying.reduce((sum, row) => sum + row.count, 0);
  const founder = await getFounderMetrics(tz, { mrrCents, paying: payingCount });

  return {
    generatedAt: new Date().toISOString(),
    timeZone: tz,
    people,
    founder,
    revenue: {
      mrrCents,
      paying: payingCount,
      /** Paying memberships whose MRR is list price, not yet read from Stripe. */
      estimated: paying.reduce((sum, row) => sum + row.estimated, 0),
      trialing: count(revenue, "trialing"),
      pastDue: count(revenue, "past_due") + count(revenue, "unpaid"),
      canceled: count(revenue, "canceled"),
      byPlan: revenue,
      trialsEnding,
    },
    usage,
    money,
    funnel,
    series,
    hourly,
    byKind,
    newest,
    active,
    testUserIds: testUsers.map((row) => String(row.id)),
    support,
    deliveries,
    failures,
    stripe,
    system: {
      db: dbInfo,
      tables,
      node: process.version,
      environment: process.env.NODE_ENV ?? "unknown",
      config: configuration(),
    },
  };
}

/** What's switched on on this server — names only, never a value. */
function configuration() {
  const env = serverEnv();
  const on = (value: unknown) => Boolean(value);
  return [
    { name: "Supabase service key", on: on(env.SUPABASE_SECRET_KEY) },
    { name: "Stripe (billing)", on: on(env.STRIPE_SECRET_KEY) },
    { name: "Stripe webhook", on: on(env.STRIPE_WEBHOOK_SECRET) },
    { name: "Stripe Connect", on: on(env.STRIPE_CONNECT_CLIENT_ID) },
    { name: "Email (Resend)", on: on(env.RESEND_API_KEY) },
    { name: "Texts (Twilio)", on: on(env.TWILIO_ACCOUNT_SID) },
    { name: "Support inbox", on: on(env.SUPPORT_EMAIL) },
    { name: "Sentry in the browser", on: on(process.env.NEXT_PUBLIC_SENTRY_DSN) },
    { name: "Cron secret", on: on(env.CRON_SECRET) },
    { name: "Site URL", on: on(process.env.NEXT_PUBLIC_SITE_URL) },
  ];
}

/** A price's amount per month, in cents, for `quantity` of it — `alias` names the prices row. */
function monthly(alias: SQL, quantity: SQL) {
  return sql`case ${alias}.interval
    when 'month' then ${alias}.unit_amount * ${quantity} / greatest(${alias}.interval_count, 1)
    when 'year' then ${alias}.unit_amount * ${quantity} / 12.0 / greatest(${alias}.interval_count, 1)
    when 'week' then ${alias}.unit_amount * ${quantity} * 52 / 12.0 / greatest(${alias}.interval_count, 1)
    when 'day' then ${alias}.unit_amount * ${quantity} * 365 / 12.0 / greatest(${alias}.interval_count, 1)
    else 0 end`;
}

function count(rows: { status: string; count: number }[], status: string) {
  return rows.filter((row) => row.status === status).reduce((sum, row) => sum + row.count, 0);
}

/**
 * One query at a time. Fired together, the eighteen queries pile up on the single
 * dev connection through Supabase's transaction pooler and stall until the
 * statement timeout; one after another they take under a second.
 */
async function inOrder<T extends (() => Promise<unknown>)[]>(
  steps: [...T]
): Promise<{ [K in keyof T]: Awaited<ReturnType<T[K]>> }> {
  const results: unknown[] = [];
  for (const step of steps) results.push(await step());
  return results as { [K in keyof T]: Awaited<ReturnType<T[K]>> };
}

/** A row as it crosses to the browser: numbers, text, flags, and dates as text. */
export type Row = Record<string, string | number | boolean | null>;

async function one(query: ReturnType<typeof sql>): Promise<Row> {
  const rows = await db.execute<Row>(query);
  return rows[0] ?? {};
}

async function many(query: ReturnType<typeof sql>): Promise<Row[]> {
  const rows = await db.execute<Row>(query);
  return [...rows];
}
