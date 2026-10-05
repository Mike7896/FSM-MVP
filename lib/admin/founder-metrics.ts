import "server-only";

import { sql } from "drizzle-orm";

import { db } from "@/lib/db";

import { REAL_ORG, realUser } from "./counting";

/**
 * THE FOUNDER'S NUMBERS — is the business working, and is the product used?
 *
 * Revenue, from ServiceClerk's own billing: MRR movement (new, expansion,
 * reactivation, contraction, churn), churn rates, lifetime value, revenue at
 * risk, the cash actually collected, refunds, and the platform's fees on
 * contractors' card payments. Usage, from who had the app open in which hour:
 * daily/weekly/monthly active users, stickiness, retention by signup week,
 * activation, and when in the day contractors work.
 *
 * **Honest about history.** MRR movement and activity are recorded from the
 * moment their tables existed (drizzle/0050); the activity history reaches
 * back to the event log's start. Every windowed number says how much history
 * it stands on, and a rate that needs more than there is — LTV with no churn
 * yet — is `null`, never a guess.
 *
 * Test, internal and tester data never count (`./counting`). Days are cut on
 * the viewer's clock.
 */

export type FounderMetrics = Awaited<ReturnType<typeof getFounderMetrics>>;

const DAY_MS = 86_400_000;

/** The database, or a transaction — the check script runs these inside one it rolls back. */
export type Executor = Pick<typeof db, "execute">;

export async function getFounderMetrics(
  timeZone: string,
  current: { mrrCents: number; paying: number },
  executor: Executor = db
) {
  const tz = timeZone;
  const one = (query: ReturnType<typeof sql>) => first(executor, query);
  const many = (query: ReturnType<typeof sql>) => all(executor, query);
  const today = sql`(date_trunc('day', now() at time zone ${tz}) at time zone ${tz})`;
  const days = sql`(
    select generate_series(
      (date_trunc('day', now() at time zone ${tz}) - interval '29 days')::date,
      (date_trunc('day', now() at time zone ${tz}))::date,
      interval '1 day'
    )::date as day
  )`;

  // One query at a time — see `inOrder` in ./metrics.
  const movement = await one(sql`
    select
      coalesce(sum(c.to_cents - c.from_cents) filter (where c.kind = 'new'), 0)::bigint as new_cents,
      count(*) filter (where c.kind = 'new')::int as new_count,
      coalesce(sum(c.to_cents - c.from_cents) filter (where c.kind = 'reactivation'), 0)::bigint as reactivation_cents,
      count(*) filter (where c.kind = 'reactivation')::int as reactivation_count,
      coalesce(sum(c.to_cents - c.from_cents) filter (where c.kind = 'expansion'), 0)::bigint as expansion_cents,
      count(*) filter (where c.kind = 'expansion')::int as expansion_count,
      coalesce(sum(c.to_cents - c.from_cents) filter (where c.kind = 'contraction'), 0)::bigint as contraction_cents,
      count(*) filter (where c.kind = 'contraction')::int as contraction_count,
      coalesce(sum(c.to_cents - c.from_cents) filter (where c.kind = 'churn'), 0)::bigint as churn_cents,
      count(*) filter (where c.kind = 'churn')::int as churn_count
    from mrr_changes c join organizations o on o.id = c.organization_id
    where ${REAL_ORG} and c.kind <> 'baseline' and c.changed_at > now() - interval '30 days'
  `);

  // Where the 30-day window starts — or where tracking does, if later — and
  // what each membership brought in at that moment.
  const start = await one(sql`
    with t0 as (
      select greatest(now() - interval '30 days', coalesce((select min(changed_at) from mrr_changes), now())) as at
    ),
    latest as (
      select distinct on (c.organization_id) c.to_cents
      from mrr_changes c join organizations o on o.id = c.organization_id, t0
      where ${REAL_ORG} and c.changed_at <= t0.at
      order by c.organization_id, c.changed_at desc, c.id desc
    )
    select
      (select at from t0) as window_start,
      (select min(changed_at) from mrr_changes) as tracking_since,
      coalesce((select sum(to_cents) from latest), 0)::bigint as mrr_cents,
      (select count(*) from latest where to_cents > 0)::int as paying
  `);

  const mrrSeries = await many(sql`
    with days as ${days},
    since as (select coalesce(min(changed_at), now()) as at from mrr_changes)
    select to_char(d.day, 'YYYY-MM-DD') as day,
      case when ((d.day + 1)::timestamp at time zone ${tz}) <= (select at from since) then null else (
        select coalesce(sum(latest.to_cents), 0)::bigint from (
          select distinct on (c.organization_id) c.to_cents
          from mrr_changes c join organizations o on o.id = c.organization_id
          where ${REAL_ORG} and c.changed_at < ((d.day + 1)::timestamp at time zone ${tz})
          order by c.organization_id, c.changed_at desc, c.id desc
        ) latest
      ) end as mrr_cents
    from days d order by d.day
  `);

  const risk = await one(sql`
    select coalesce(sum((to_jsonb(ba) ->> 'mrr_cents')::bigint), 0)::bigint as cents, count(*)::int as count
    from billing_accounts ba join organizations o on o.id = ba.organization_id
    where ${REAL_ORG} and ba.subscription_status in ('past_due', 'unpaid')
  `);

  const cash = await one(sql`
    with paid as (
      select i.amount_paid_cents as cents, i.paid_at as at
      from platform_invoices i join organizations o on o.id = i.organization_id
      where ${REAL_ORG} and i.currency = 'usd'
    ),
    refunds as (
      select e.occurred_at as at, (r ->> 'amount')::bigint as cents
      from billing_events e join organizations o on o.id = e.organization_id
      cross join lateral jsonb_array_elements(coalesce(e.detail -> 'refunded', '[]'::jsonb)) r
      where ${REAL_ORG} and e.kind = 'guarantee.refunded'
    ),
    fees as (
      select pa.application_fee_cents - pa.fee_refunded_cents as cents, pa.created_at as at
      from payment_attempts pa join organizations o on o.id = pa.organization_id
      where ${REAL_ORG} and pa.status in ('succeeded', 'refunded', 'disputed')
    )
    select
      coalesce((select sum(cents) from paid where at > now() - interval '30 days'), 0)::bigint as collected_30d,
      (select count(*) from paid where at > now() - interval '30 days')::int as invoices_30d,
      coalesce((select sum(cents) from paid), 0)::bigint as collected_all,
      coalesce((select sum(cents) from refunds where at > now() - interval '30 days'), 0)::bigint as refunded_30d,
      coalesce((select sum(cents) from fees where at > now() - interval '30 days'), 0)::bigint as fees_30d,
      coalesce((select sum(cents) from fees), 0)::bigint as fees_all,
      (select min(paid_at) from platform_invoices) as collected_since
  `);

  const planMix = await many(sql`
    select ba.tier, coalesce(ba.interval, 'month') as interval, count(*)::int as shops,
      count(*) filter (where ba.founding_price)::int as founding,
      coalesce(sum((to_jsonb(ba) ->> 'mrr_cents')::bigint), 0)::bigint as mrr_cents
    from billing_accounts ba join organizations o on o.id = ba.organization_id
    where ${REAL_ORG} and ba.tier <> 'free' and ba.subscription_status in ('active', 'past_due', 'unpaid', 'trialing')
    group by 1, 2 order by 3 desc
  `);

  const packs = await many(sql`
    with owned as (
      select unnest(ba.packs) as pack
      from billing_accounts ba join organizations o on o.id = ba.organization_id
      where ${REAL_ORG} and ba.subscription_status in ('active', 'past_due', 'unpaid', 'trialing')
    ),
    trials as (
      select pe.pack_id as pack,
        count(*)::int as started,
        count(*) filter (where pe.ended_at is not null)::int as bought,
        count(*) filter (where pe.ended_at is null and pe.expires_at < now())::int as lapsed,
        count(*) filter (where pe.ended_at is null and pe.expires_at >= now())::int as running
      from pack_evaluations pe join organizations o on o.id = pe.organization_id
      where ${REAL_ORG}
      group by 1
    )
    select coalesce(t.pack, w.pack) as pack, coalesce(w.shops, 0)::int as shops,
      coalesce(t.started, 0) as started, coalesce(t.bought, 0) as bought,
      coalesce(t.lapsed, 0) as lapsed, coalesce(t.running, 0) as running
    from trials t full join (select pack, count(*)::int as shops from owned group by 1) w on w.pack = t.pack
    order by 1
  `);

  const activity = await one(sql`
    with act as (
      select a.user_id, a.organization_id, a.hour from user_activity_hours a
      where a.hour > now() - interval '31 days' and ${realUser(sql`a.user_id`)}
    )
    select
      (select count(distinct user_id) from act where hour >= ${today})::int as dau,
      (select count(distinct user_id) from act where hour > now() - interval '7 days')::int as wau,
      (select count(distinct user_id) from act where hour > now() - interval '30 days')::int as mau,
      (select count(distinct a.organization_id) from act a join organizations o on o.id = a.organization_id
        where ${REAL_ORG} and a.hour > now() - interval '7 days')::int as shops_7d,
      (select min(hour) from user_activity_hours) as tracking_since
  `);

  const dauSeries = await many(sql`
    with days as ${days},
    act as (
      select a.user_id, (a.hour at time zone ${tz})::date as day from user_activity_hours a
      where a.hour > now() - interval '31 days' and ${realUser(sql`a.user_id`)}
    )
    select to_char(d.day, 'YYYY-MM-DD') as day,
      (select count(distinct act.user_id) from act where act.day = d.day)::int as users
    from days d order by d.day
  `);

  const hours = await many(sql`
    select extract(hour from a.hour at time zone ${tz})::int as hour, count(*)::int as user_hours
    from user_activity_hours a
    where a.hour > now() - interval '30 days' and ${realUser(sql`a.user_id`)}
    group by 1 order by 1
  `);

  // Of the people who signed up in each of the last eight weeks, how many
  // came back in each of the four weeks after.
  const retention = await many(sql`
    with people as (
      select p.id, date_trunc('week', p.created_at at time zone ${tz})::date as cohort
      from profiles p
      where ${realUser(sql`p.id`)} and p.created_at > now() - interval '9 weeks'
    ),
    weeks as (
      select a.user_id, date_trunc('week', a.hour at time zone ${tz})::date as week
      from user_activity_hours a group by 1, 2
    )
    select to_char(pp.cohort, 'YYYY-MM-DD') as cohort, count(distinct pp.id)::int as people,
      count(distinct w1.user_id)::int as w1, count(distinct w2.user_id)::int as w2,
      count(distinct w3.user_id)::int as w3, count(distinct w4.user_id)::int as w4
    from people pp
    left join weeks w1 on w1.user_id = pp.id and w1.week = pp.cohort + 7
    left join weeks w2 on w2.user_id = pp.id and w2.week = pp.cohort + 14
    left join weeks w3 on w3.user_id = pp.id and w3.week = pp.cohort + 21
    left join weeks w4 on w4.user_id = pp.id and w4.week = pp.cohort + 28
    group by pp.cohort order by pp.cohort desc
  `);
  const thisWeek = await one(sql`select to_char(date_trunc('week', now() at time zone ${tz})::date, 'YYYY-MM-DD') as week`);

  // Activation: a shop sends its first real quote. Judged on shops at least a
  // week old, so every one has had its full seven days.
  const activation = await one(sql`
    with first_send as (
      select s.organization_id, min(s.sent_at) as at
      from document_sends s join documents d on d.id = s.document_id join jobs j on j.id = d.job_id
      where d.type = 'quote' and not j.is_demo
      group by 1
    ),
    shops as (
      select o.id, o.created_at, f.at as first_quote
      from organizations o left join first_send f on f.organization_id = o.id
      where ${REAL_ORG} and o.created_at > now() - interval '90 days'
    )
    select
      (select count(*) from shops where created_at < now() - interval '7 days')::int as judged,
      (select count(*) from shops where created_at < now() - interval '7 days'
        and first_quote <= created_at + interval '7 days')::int as activated,
      (select percentile_cont(0.5) within group (order by extract(epoch from (first_quote - created_at)) / 3600)
        from shops where first_quote is not null) as median_hours,
      (select count(*) from shops where first_quote is not null)::int as with_quote
  `);

  // What it costs to run, from the provider records on Costs & Usage — only
  // ones whose billing period covers today, in dollars.
  const costs = await one(sql`
    select coalesce(sum((u.configuration ->> 'reported')::numeric), 0)::float as reported_dollars,
      count(*) filter (where u.configuration ->> 'reported' is not null)::int as providers
    from platform_usage u
    where u.configuration ->> 'currency' = 'USD'
      and (u.configuration ->> 'start')::date <= current_date
      and current_date < (u.configuration ->> 'end')::date
  `);

  /* ── Derived ──────────────────────────────────────────────────────── */

  const n = (value: unknown) => {
    const number = Number(value ?? 0);
    return Number.isFinite(number) ? number : 0;
  };
  const windowStart = start.window_start ? new Date(String(start.window_start)) : new Date();
  const windowDays = Math.max(0, Math.round((Date.now() - windowStart.getTime()) / DAY_MS));
  const startMrr = n(start.mrr_cents);
  const startPaying = n(start.paying);
  const lostCents = -(n(movement.churn_cents) + n(movement.contraction_cents));
  const revenueChurn = startMrr > 0 ? lostCents / startMrr : null;
  const customerChurn = startPaying > 0 ? n(movement.churn_count) / startPaying : null;
  const arpaCents = current.paying > 0 ? current.mrrCents / current.paying : null;
  // A lifetime needs a churn rate measured over a real month, and some churn.
  const monthlyChurn = customerChurn !== null && windowDays >= 28 ? customerChurn * (30 / windowDays) : null;
  const ltvCents = arpaCents !== null && monthlyChurn ? arpaCents / monthlyChurn : null;

  const trackedFrom = activity.tracking_since ? String(activity.tracking_since).slice(0, 10) : null;
  const dau = dauSeries.map((row) => ({ day: String(row.day), users: n(row.users) }));
  const tracked = trackedFrom ? dau.filter((row) => row.day >= trackedFrom) : [];
  const avgDau = tracked.length ? tracked.reduce((sum, row) => sum + row.users, 0) / tracked.length : 0;
  const mau = n(activity.mau);

  const byHour = Array.from({ length: 24 }, (_, hour) => n(hours.find((row) => n(row.hour) === hour)?.user_hours));
  const week = String(thisWeek.week);
  const addDays = (date: string, count: number) =>
    new Date(Date.parse(`${date}T00:00:00Z`) + count * DAY_MS).toISOString().slice(0, 10);

  const costCents = Math.round(n(costs.reported_dollars) * 100);

  return {
    revenue: {
      mrrCents: current.mrrCents,
      arrCents: current.mrrCents * 12,
      paying: current.paying,
      arpaCents,
      ltvCents,
      movement: {
        newCents: n(movement.new_cents),
        newCount: n(movement.new_count),
        reactivationCents: n(movement.reactivation_cents),
        reactivationCount: n(movement.reactivation_count),
        expansionCents: n(movement.expansion_cents),
        expansionCount: n(movement.expansion_count),
        contractionCents: n(movement.contraction_cents),
        contractionCount: n(movement.contraction_count),
        churnCents: n(movement.churn_cents),
        churnCount: n(movement.churn_count),
        netCents:
          n(movement.new_cents) + n(movement.reactivation_cents) + n(movement.expansion_cents) +
          n(movement.contraction_cents) + n(movement.churn_cents),
      },
      /** Churn over the window below — 30 days, or since tracking began. */
      revenueChurn,
      customerChurn,
      windowDays,
      trackingSince: start.tracking_since ? new Date(String(start.tracking_since)).toISOString() : null,
      series: mrrSeries.map((row) => ({
        day: String(row.day),
        mrrCents: row.mrr_cents === null ? null : n(row.mrr_cents),
      })),
      atRisk: { cents: n(risk.cents), count: n(risk.count) },
      cash: {
        collected30dCents: n(cash.collected_30d),
        invoices30d: n(cash.invoices_30d),
        collectedAllCents: n(cash.collected_all),
        refunded30dCents: n(cash.refunded_30d),
        net30dCents: n(cash.collected_30d) - n(cash.refunded_30d),
        fees30dCents: n(cash.fees_30d),
        feesAllCents: n(cash.fees_all),
        since: cash.collected_since ? new Date(String(cash.collected_since)).toISOString() : null,
      },
      planMix: planMix.map((row) => ({
        tier: String(row.tier),
        interval: String(row.interval),
        shops: n(row.shops),
        founding: n(row.founding),
        mrrCents: n(row.mrr_cents),
      })),
      packs: packs.map((row) => ({
        pack: String(row.pack),
        shops: n(row.shops),
        trialsStarted: n(row.started),
        trialsBought: n(row.bought),
        trialsLapsed: n(row.lapsed),
        trialsRunning: n(row.running),
      })),
    },
    usage: {
      dau: n(activity.dau),
      wau: n(activity.wau),
      mau,
      avgDau,
      /** Average daily users ÷ monthly users — how much of the month a user's in. */
      stickiness: mau > 0 ? avgDau / mau : null,
      activeShops7d: n(activity.shops_7d),
      trackingSince: trackedFrom,
      dauSeries: dau,
      byHour,
      retention: retention.map((row) => {
        const cohort = String(row.cohort);
        const people = n(row.people);
        const after = (weeks: number, value: unknown) => (addDays(cohort, weeks * 7) > week ? null : n(value));
        return { cohort, people, weeks: [after(1, row.w1), after(2, row.w2), after(3, row.w3), after(4, row.w4)] };
      }),
      activation: {
        judged: n(activation.judged),
        activated: n(activation.activated),
        rate: n(activation.judged) > 0 ? n(activation.activated) / n(activation.judged) : null,
        medianHoursToFirstQuote: activation.median_hours === null ? null : n(activation.median_hours),
        withQuote: n(activation.with_quote),
      },
    },
    costs: {
      reportedCents: costCents,
      providers: n(costs.providers),
      mrrAfterCostsCents: current.mrrCents - costCents,
      perPayingCents: current.paying > 0 ? costCents / current.paying : null,
    },
  };
}

type Row = Record<string, string | number | boolean | null>;

async function first(executor: Executor, query: ReturnType<typeof sql>): Promise<Row> {
  const rows = await executor.execute<Row>(query);
  return rows[0] ?? {};
}

async function all(executor: Executor, query: ReturnType<typeof sql>): Promise<Row[]> {
  return [...(await executor.execute<Row>(query))];
}
