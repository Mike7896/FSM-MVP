/**
 * The admin dashboard's event log, checked against a real database.
 *
 * - **Each trigger writes the line it should** — a new business, a job, a quote
 *   started, sent (the first one a milestone), opened (once), won (the first
 *   one a milestone), a trial, a purchase, a cancellation, a payment, a bug
 *   report.
 * - **A check script's shop is marked test**, so it never counts — and so is
 *   a shop a test account sets up under any name, and its sign-ins.
 * - **Logging never breaks a write**: a bad line is swallowed.
 * - **The live dashboard hears every counted write**, and not an autosave.
 * - **Only admins can read it**, or hear the signal.
 *
 * The whole run is one transaction that is rolled back at the end — the ledger
 * is append-only and can't be cleaned up any other way — so nothing it does is
 * kept, and nothing reaches the live dashboard.
 *
 *     npm run admin:check
 */

import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { sql } from "drizzle-orm";

import { listAccounts } from "@/lib/admin/accounts";
import { getFounderMetrics } from "@/lib/admin/founder-metrics";
import { checkSendAllowance } from "@/lib/admin/limits";
import { db } from "@/lib/db";

let passed = 0;
const failures: string[] = [];

function check(label: string, condition: boolean, detail?: string) {
  if (condition) {
    passed += 1;
    console.log(`  ok   ${label}`);
  } else {
    failures.push(`${label}${detail ? ` — ${detail}` : ""}`);
    console.log(`  FAIL ${label}${detail ? ` — ${detail}` : ""}`);
  }
}

class Rollback extends Error {}

type Event = { kind: string; level: string; title: string; amount_cents: string | null; test: boolean; demo: boolean };

try {
  await db.transaction(async (tx) => {
    const run = async <T extends Record<string, unknown>>(query: ReturnType<typeof sql>) =>
      [...(await tx.execute<T>(query))];
    let seen = 0;
    /** The lines written since the last time we looked. */
    const since = async (org: string) => {
      const rows = await run<Event & { id: string }>(
        sql`select id, kind, level, title, amount_cents::text, test, demo from admin_events
            where organization_id = ${org} and id > ${seen} order by id`
      );
      if (rows.length) seen = Number(rows[rows.length - 1].id);
      return rows;
    };

    const slug = `admin-check-${Date.now()}`;
    const [org] = await run<{ id: string }>(sql`insert into organizations (name, slug) values ('Mercer Electric', ${slug}) returning id`);
    // "Set up their business" is written at commit (drizzle/0047), and this
    // transaction never commits — so it's told to write it now.
    await run(sql`set constraints admin_on_organization immediate`);

    console.log("");
    console.log("A NEW BUSINESS");
    let lines = await since(org.id);
    check("setting up a business is a milestone", lines.some((e) => e.kind === "business.created" && e.level === "milestone"));
    check("…named in the line", lines.some((e) => e.title === "Mercer Electric set up their business"), JSON.stringify(lines));
    check("a check script's shop is marked test", lines.every((e) => e.test));

    const [customer] = await run<{ id: string }>(sql`insert into customers (organization_id, name) values (${org.id}, 'Jean Petersen') returning id`);
    const [job] = await run<{ id: string; number: number }>(
      sql`insert into jobs (organization_id, customer_id, name) values (${org.id}, ${customer.id}, 'Panel upgrade') returning id, number`
    );
    lines = await since(org.id);
    check("opening a job is activity", lines.some((e) => e.kind === "job.created" && e.level === "activity" && e.title.includes(`#${job.number}`)));

    console.log("");
    console.log("A QUOTE, FROM START TO WON");
    const [quote] = await run<{ id: string; number: string }>(
      sql`insert into documents (organization_id, job_id, customer_id, type, status) values (${org.id}, ${job.id}, ${customer.id}, 'quote', 'draft') returning id, number`
    );
    lines = await since(org.id);
    check("starting a quote is logged", lines.some((e) => e.kind === "quote.created" && e.title.includes(quote.number)));

    await run(sql`insert into document_sends (organization_id, document_id, channel, recipient) values (${org.id}, ${quote.id}, 'email', 'jean@example.com')`);
    lines = await since(org.id);
    check("the first quote sent is a milestone", lines.some((e) => e.kind === "quote.sent" && e.level === "milestone" && e.title === "Mercer Electric sent their first quote"), JSON.stringify(lines));
    await run(sql`insert into document_sends (organization_id, document_id, channel) values (${org.id}, ${quote.id}, 'link')`);
    lines = await since(org.id);
    check("sending the same quote again is only activity", lines.length === 1 && lines[0].level === "activity", JSON.stringify(lines));

    const [link] = await run<{ id: string }>(
      sql`insert into share_links (token, job_id, document_id) values (${`admin-check-${Date.now()}`}, ${job.id}, ${quote.id}) returning id`
    );
    await run(sql`insert into share_link_views (share_link_id) values (${link.id})`);
    lines = await since(org.id);
    check("the customer opening it is logged", lines.some((e) => e.kind === "quote.opened"));
    await run(sql`insert into share_link_views (share_link_id) values (${link.id})`);
    check("…once, not on every look", (await since(org.id)).length === 0);

    await run(sql`update documents set status = 'accepted' where id = ${quote.id}`);
    lines = await since(org.id);
    check("the first win is a milestone", lines.some((e) => e.kind === "quote.accepted" && e.title.startsWith("Mercer Electric won their first job")), JSON.stringify(lines));

    console.log("");
    console.log("A SUBSCRIPTION'S LIFE");
    const sub = `sub_admincheck_${Date.now()}`;
    await run(sql`insert into subscriptions (id, organization_id, status) values (${sub}, ${org.id}, 'trialing')`);
    lines = await since(org.id);
    check("a trial starting is a milestone", lines.some((e) => e.kind === "trial.started" && e.level === "milestone"));
    await run(sql`update subscriptions set status = 'active' where id = ${sub}`);
    lines = await since(org.id);
    check("a trial turning paid is money", lines.some((e) => e.kind === "subscription.started" && e.level === "money" && e.title.includes("turned their trial into")), JSON.stringify(lines));
    await run(sql`update subscriptions set cancel_at_period_end = true where id = ${sub}`);
    lines = await since(org.id);
    check("setting it to end is a problem", lines.some((e) => e.kind === "subscription.cancel_scheduled" && e.level === "problem"));
    await run(sql`update subscriptions set status = 'canceled' where id = ${sub}`);
    lines = await since(org.id);
    check("canceling is a problem", lines.some((e) => e.kind === "subscription.canceled" && e.level === "problem"));

    console.log("");
    console.log("MONEY AND TROUBLE");
    await run(sql`insert into ledger_entries (organization_id, job_id, entry_type, amount_cents, occurred_at, source) values (${org.id}, ${job.id}, 'payment_received', 12345, now(), 'manual')`);
    lines = await since(org.id);
    check("a payment is money, with its amount", lines.some((e) => e.kind === "payment.received" && e.level === "money" && e.amount_cents === "12345" && e.title === "Mercer Electric got paid $123.45 (recorded)"), JSON.stringify(lines));

    await run(sql`insert into support_requests (organization_id, kind, subject, body, reply_to) values (${org.id}, 'bug', 'Board drag', 'Wrong column.', 'check@example.com')`);
    lines = await since(org.id);
    check("a bug report is a problem", lines.some((e) => e.kind === "support.bug" && e.level === "problem" && e.title.includes("Board drag")));

    await run(sql`select public.admin_log('bad.level', 'not-a-level', ${org.id}::uuid, null, 'x')`);
    check("a bad line is swallowed, not thrown", (await since(org.id)).length === 0);

    console.log("");
    console.log("A TEST ACCOUNT'S DAILY CAP");
    const [me] = await run<{ id: string }>(sql`select id from profiles order by created_at limit 1`);
    await run(sql`insert into account_policies (user_id, kind, daily_send_limit) values (${me.id}, 'tester', 2)
      on conflict (user_id) do update set kind = 'tester', daily_send_limit = 2`);
    const [already] = await run<{ n: number }>(sql`select count(*)::int as n from document_sends where sent_by = ${me.id} and sent_at > now() - interval '24 hours'`);
    const under = async () => {
      try {
        await checkSendAllowance(me.id, tx);
        return true;
      } catch {
        return false;
      }
    };
    if (already.n < 2) {
      check("under the cap, sending is allowed", await under());
    }
    for (let i = already.n; i < 2; i += 1) {
      await run(sql`insert into document_sends (organization_id, document_id, channel, sent_by) values (${org.id}, ${quote.id}, 'link', ${me.id})`);
    }
    check("at the cap, the next send is refused", !(await under()));
    await run(sql`update account_policies set daily_send_limit = null where user_id = ${me.id}`);
    check("with no cap, sending is always allowed", await under());

    console.log("");
    console.log("WHAT COUNTS AS TEST");
    // A shop named like a real one, set up by a check script's throwaway
    // account — the kind that used to reach the dashboard as real news.
    const stamp = Date.now();
    const [robot] = await run<{ id: string }>(
      sql`insert into auth.users (id, email, aud, role) values (gen_random_uuid(), ${`robot-${stamp}@example.invalid`}, 'authenticated', 'authenticated') returning id`
    );
    const [lookalike] = await run<{ id: string }>(
      sql`insert into organizations (name, slug, created_by) values ('Rivera Plumbing', ${`rivera-plumbing-${stamp}`}, ${robot.id}) returning id`
    );
    lines = await since(lookalike.id);
    check("a shop a test account sets up is test, whatever it's called", lines.length > 0 && lines.every((e) => e.test), JSON.stringify(lines));
    await run(sql`insert into memberships (organization_id, user_id, role) values (${lookalike.id}, ${robot.id}, 'owner')`);
    await run(sql`insert into auth.sessions (id, user_id) values (gen_random_uuid(), ${robot.id})`);
    await run(sql`insert into support_requests (organization_id, kind, subject, body, reply_to) values (${lookalike.id}, 'idea', 'Dark mode', 'Please.', 'robot@example.invalid')`);
    lines = await since(lookalike.id);
    check("…and its sign-in is test", lines.some((e) => e.kind === "signin" && e.test), JSON.stringify(lines));
    check("…and so is a line in it with nobody named", lines.some((e) => e.kind === "support.idea" && e.test), JSON.stringify(lines));

    const [empty] = await run<{ id: string }>(
      sql`insert into organizations (name, slug) values ('Rivera Plumbing', ${`rivera-plumbing-empty-${stamp}`}) returning id`
    );
    lines = await since(empty.id);
    check("a shop nobody is in is test", lines.length > 0 && lines.every((e) => e.test), JSON.stringify(lines));

    // A real sign-up: the shop and its owner in one transaction, the way
    // app/api/v1/organizations does it, logged as it would be at commit.
    const [person] = await run<{ id: string }>(
      sql`insert into auth.users (id, email, aud, role) values (gen_random_uuid(), ${`owner-${stamp}@rivera-plumbing.com`}, 'authenticated', 'authenticated') returning id`
    );
    await run(sql`set constraints admin_on_organization deferred`);
    const [genuine] = await run<{ id: string }>(
      sql`insert into organizations (name, slug, created_by) values ('Rivera Plumbing', ${`rivera-plumbing-real-${stamp}`}, ${person.id}) returning id`
    );
    check("…nothing is written before the owner joins", (await since(genuine.id)).length === 0);
    await run(sql`insert into memberships (organization_id, user_id, role) values (${genuine.id}, ${person.id}, 'owner')`);
    await run(sql`set constraints admin_on_organization immediate`);
    lines = await since(genuine.id);
    check("a real person's new shop is real", lines.some((e) => e.kind === "business.created") && lines.every((e) => !e.test), JSON.stringify(lines));
    const [rule] = await run<{ fake: boolean; empty: boolean; real: boolean }>(
      sql`select public.admin_is_test_org(${lookalike.id}) as fake, public.admin_is_test_org(${empty.id}) as empty,
        public.admin_is_test_org(${genuine.id}) as real`
    );
    check("the dashboard's numbers use the same rule", rule.fake && rule.empty && !rule.real, JSON.stringify(rule));

    console.log("");
    console.log("INTERNAL ACCOUNTS");
    // One of ours, with a shop of their own — logged as real until switched.
    const [founder] = await run<{ id: string }>(
      sql`insert into auth.users (id, email, aud, role) values (gen_random_uuid(), ${`founder-${stamp}@mercer-electric.com`}, 'authenticated', 'authenticated') returning id`
    );
    await run(sql`set constraints admin_on_organization deferred`);
    const [ours] = await run<{ id: string }>(
      sql`insert into organizations (name, slug, created_by) values ('Mercer Painting', ${`mercer-painting-${stamp}`}, ${founder.id}) returning id`
    );
    await run(sql`insert into memberships (organization_id, user_id, role) values (${ours.id}, ${founder.id}, 'owner')`);
    await run(sql`set constraints admin_on_organization immediate`);
    lines = await since(ours.id);
    const internalOf = async (org: string) =>
      (await run<{ internal: boolean }>(sql`select internal from admin_events where organization_id = ${org} order by id`)).map((row) => row.internal);
    check("before the switch, their shop's lines are ordinary", (await internalOf(ours.id)).every((flag) => !flag));
    await run(sql`insert into account_policies (user_id, internal) values (${founder.id}, true)`);
    const [refreshed] = await run<{ n: number }>(sql`select public.admin_refresh_internal(${founder.id}::uuid) as n`);
    check("switching them to internal re-marks what's already logged", refreshed.n > 0 && (await internalOf(ours.id)).every(Boolean), String(refreshed.n));
    await run(sql`insert into support_requests (organization_id, kind, subject, body, reply_to) values (${ours.id}, 'bug', 'Board drag', 'Wrong column.', 'founder@mercer-electric.com')`);
    lines = await since(ours.id);
    check("…and what's logged after is internal from the start", (await internalOf(ours.id)).every(Boolean));
    check("internal isn't test — it still shows in the feed", (await since(ours.id)).length === 0 && lines.every((e) => !e.test), JSON.stringify(lines));
    await run(sql`insert into memberships (organization_id, user_id, role) values (${genuine.id}, ${founder.id}, 'admin')`);
    const [shops] = await run<{ ours: boolean; theirs: boolean }>(
      sql`select public.admin_is_internal_org(${ours.id}) as ours, public.admin_is_internal_org(${genuine.id}) as theirs`
    );
    check("their shop is internal; a customer's shop they help in isn't", shops.ours && !shops.theirs, JSON.stringify(shops));
    await run(sql`update account_policies set internal = false where user_id = ${founder.id}`);
    await run(sql`select public.admin_refresh_internal(${founder.id}::uuid)`);
    check("switching back un-marks it", (await internalOf(ours.id)).every((flag) => !flag));

    console.log("");
    console.log("THE FOUNDER'S NUMBERS");
    // Four shops run by one real person, each with a known money story.
    const [books] = await run<{ id: string }>(
      sql`insert into auth.users (id, email, aud, role) values (gen_random_uuid(), ${`books-${stamp}@hollis-roofing.com`}, 'authenticated', 'authenticated') returning id`
    );
    const shop = async (name: string) => {
      const [row] = await run<{ id: string }>(sql`insert into organizations (name, slug, created_by) values (${name}, ${`${name.toLowerCase().replace(/ /g, "-")}-${stamp}`}, ${books.id}) returning id`);
      await run(sql`insert into memberships (organization_id, user_id, role) values (${row.id}, ${books.id}, 'owner')`);
      return row.id;
    };
    const [shopA, shopB, shopC, shopD] = [await shop("Hollis Roofing"), await shop("Hollis Gutters"), await shop("Hollis Siding"), await shop("Hollis Solar")];

    // Every change to a membership's MRR is classified as it's written.
    await run(sql`insert into billing_accounts (organization_id, tier, interval, subscription_status) values (${shopA}, 'pro', 'month', 'active')`);
    for (const cents of [4900, 5700, 3900, 0, 4900]) {
      await run(sql`update billing_accounts set mrr_cents = ${cents} where organization_id = ${shopA}`);
    }
    const kinds = (await run<{ kind: string }>(sql`select kind from mrr_changes where organization_id = ${shopA} order by id`)).map((row) => row.kind);
    check("an MRR change is classified as it's written", kinds.join() === "new,expansion,contraction,churn,reactivation", kinds.join());

    // A clean slate for the two history tables, so the windows are exact;
    // everything else is measured as a difference.
    await run(sql`delete from mrr_changes`);
    await run(sql`delete from user_activity_hours`);
    const current = { mrrCents: 11400, paying: 2 };
    const before = await getFounderMetrics("UTC", current, tx);

    await run(sql`insert into billing_accounts (organization_id, tier, interval, subscription_status, mrr_cents) values
      (${shopB}, 'pro', 'month', 'active', 5700), (${shopD}, 'pro', 'month', 'past_due', 5700)`);
    await run(sql`delete from mrr_changes where organization_id in (${shopB}, ${shopD})`);
    // Forty days ago Gutters paid $49 and Siding $29. In the last month: Solar
    // signed up at $57, Gutters grew to $57, Siding left.
    await run(sql`insert into mrr_changes (organization_id, from_cents, to_cents, kind, changed_at) values
      (${shopB}, 0, 4900, 'baseline', now() - interval '40 days'),
      (${shopC}, 0, 2900, 'baseline', now() - interval '40 days'),
      (${shopD}, 0, 5700, 'new', now() - interval '10 days'),
      (${shopB}, 4900, 5700, 'expansion', now() - interval '5 days'),
      (${shopC}, 2900, 0, 'churn', now() - interval '3 days')`);
    await run(sql`insert into platform_invoices (id, organization_id, amount_paid_cents, currency, billing_reason, paid_at) values
      (${`in_recent_${stamp}`}, ${shopB}, 5700, 'usd', 'subscription_cycle', now() - interval '5 days'),
      (${`in_old_${stamp}`}, ${shopB}, 4900, 'usd', 'subscription_create', now() - interval '40 days')`);
    await run(sql`insert into billing_events (organization_id, kind, detail, occurred_at) values
      (${shopB}, 'guarantee.refunded', ${JSON.stringify({ refunded: [{ invoice: `in_recent_${stamp}`, amount: 1000 }] })}::jsonb, now() - interval '2 days')`);
    // Gutters opened 20 days ago and sent its first real quote two days in.
    await run(sql`update organizations set created_at = now() - interval '20 days' where id = ${shopB}`);
    const [buyer] = await run<{ id: string }>(sql`insert into customers (organization_id, name) values (${shopB}, 'Ada Whitlock') returning id`);
    const [roofJob] = await run<{ id: string }>(sql`insert into jobs (organization_id, customer_id, name) values (${shopB}, ${buyer.id}, 'Gutter guards') returning id`);
    const [firstQuote] = await run<{ id: string }>(
      sql`insert into documents (organization_id, job_id, customer_id, type, status) values (${shopB}, ${roofJob.id}, ${buyer.id}, 'quote', 'draft') returning id`
    );
    await run(sql`insert into document_sends (organization_id, document_id, channel, sent_at) values (${shopB}, ${firstQuote.id}, 'link', now() - interval '18 days')`);
    await run(sql`insert into payment_attempts (organization_id, invoice_id, stripe_account_id, rail, amount_cents, application_fee_cents, fee_refunded_cents, status, idempotency_key)
      values (${shopB}, ${firstQuote.id}, 'acct_check', 'card', 10000, 150, 50, 'succeeded', ${`check-${stamp}`})`);
    // In the app today, three days ago, and twenty days ago.
    await run(sql`insert into user_activity_hours (user_id, hour, organization_id) values
      (${books.id}, date_trunc('hour', now()), ${shopB}),
      (${books.id}, date_trunc('hour', now() - interval '3 days'), ${shopB}),
      (${books.id}, date_trunc('hour', now() - interval '20 days'), ${shopB})`);

    const after = await getFounderMetrics("UTC", current, tx);
    const { movement } = after.revenue;
    check(
      "MRR movement: $57 new, $8 expansion, $29 churned, $36 net",
      movement.newCents === 5700 && movement.newCount === 1 && movement.expansionCents === 800 &&
        movement.churnCents === -2900 && movement.churnCount === 1 && movement.contractionCents === 0 && movement.netCents === 3600,
      JSON.stringify(movement)
    );
    check(
      "churn is measured against the month's start: $29 of $78, one shop of two",
      Math.abs((after.revenue.revenueChurn ?? 0) - 2900 / 7800) < 1e-9 && after.revenue.customerChurn === 0.5 && after.revenue.windowDays === 30,
      JSON.stringify({ revenue: after.revenue.revenueChurn, customers: after.revenue.customerChurn, days: after.revenue.windowDays })
    );
    check("ARR, ARPA and lifetime value follow", after.revenue.arrCents === 136800 && after.revenue.arpaCents === 5700 && after.revenue.ltvCents === 11400,
      JSON.stringify({ arr: after.revenue.arrCents, arpa: after.revenue.arpaCents, ltv: after.revenue.ltvCents }));
    const trend = after.revenue.series;
    check("the MRR trend runs from $78 a month ago to $114 today", trend[0].mrrCents === 7800 && trend[trend.length - 1].mrrCents === 11400,
      JSON.stringify([trend[0], trend[trend.length - 1]]));
    const cashBefore = before.revenue.cash;
    const cashAfter = after.revenue.cash;
    check(
      "cash: $57 collected this month, $106 all time, $10 refunded, $1 in fees",
      cashAfter.collected30dCents - cashBefore.collected30dCents === 5700 && cashAfter.collectedAllCents - cashBefore.collectedAllCents === 10600 &&
        cashAfter.refunded30dCents - cashBefore.refunded30dCents === 1000 && cashAfter.fees30dCents - cashBefore.fees30dCents === 100,
      JSON.stringify(cashAfter)
    );
    check("revenue at risk is the past-due shop's $57", after.revenue.atRisk.cents - before.revenue.atRisk.cents === 5700 && after.revenue.atRisk.count - before.revenue.atRisk.count === 1);
    const proMonth = (metrics: typeof after) => metrics.revenue.planMix.find((row) => row.tier === "pro" && row.interval === "month")?.shops ?? 0;
    check("plan mix counts the paying shops", proMonth(after) - proMonth(before) === 2, JSON.stringify(after.revenue.planMix));
    check("one person active today, this week and this month", after.usage.dau === 1 && after.usage.wau === 1 && after.usage.mau === 1,
      JSON.stringify({ dau: after.usage.dau, wau: after.usage.wau, mau: after.usage.mau }));
    check("stickiness: in on 3 of 21 tracked days", Math.abs((after.usage.stickiness ?? 0) - 3 / 21) < 1e-9, String(after.usage.stickiness));
    check("…and the hours they were in add up", after.usage.byHour.reduce((sum, hours) => sum + hours, 0) === 3);
    check(
      "a shop that sent its first quote in two days is activated",
      after.usage.activation.judged - before.usage.activation.judged === 1 && after.usage.activation.activated - before.usage.activation.activated === 1,
      JSON.stringify(after.usage.activation)
    );
    check("a signup this week has no weeks to retain yet", after.usage.retention.some((row) => row.people >= 1 && row.weeks.every((week) => week === null)),
      JSON.stringify(after.usage.retention));

    console.log("");
    console.log("THE LIVE SIGNAL");
    // now() is when this transaction began, so this is every signal it sent.
    const signals = async () =>
      (await run<{ table: string }>(
        sql`select payload ->> 'table' as table from realtime.messages where topic = 'admin:live' and inserted_at >= now()`
      )).map((row) => row.table);
    const sent = await signals();
    check(
      "a write to a counted table signals the dashboard",
      ["organizations", "jobs", "documents", "document_sends", "subscriptions", "ledger_entries", "support_requests"].every((table) => sent.includes(table)),
      JSON.stringify([...new Set(sent)])
    );
    const quiet = (await signals()).filter((table) => table === "documents").length;
    await run(sql`update documents set updated_at = now() where id = ${quote.id}`);
    check("an autosave doesn't", (await signals()).filter((table) => table === "documents").length === quiet);
    await run(sql`update documents set status = 'declined' where id = ${quote.id}`);
    check("a quote changing status does", (await signals()).filter((table) => table === "documents").length === quiet + 1);

    console.log("");
    console.log("WHO CAN READ IT");
    await run(sql`select set_config('request.jwt.claims', ${JSON.stringify({ sub: "00000000-0000-4000-8000-000000000000", role: "authenticated" })}, true)`);
    await run(sql`select set_config('realtime.topic', 'admin:live', true)`);
    await run(sql`set local role authenticated`);
    const [visible] = await run<{ n: number }>(sql`select count(*)::int as n from admin_events where organization_id = ${org.id}`);
    check("a signed-in stranger sees none of it", visible.n === 0, String(visible.n));
    const [heard] = await run<{ n: number }>(sql`select count(*)::int as n from realtime.messages where topic = 'admin:live'`);
    check("…and can't hear the live signal", heard.n === 0, String(heard.n));
    await run(sql`reset role`);
    await run(sql`insert into platform_admins (user_id, email) values (${person.id}, ${`owner-${stamp}@rivera-plumbing.com`})`);
    await run(sql`select set_config('request.jwt.claims', ${JSON.stringify({ sub: person.id, role: "authenticated" })}, true)`);
    await run(sql`set local role authenticated`);
    const [admin] = await run<{ n: number }>(sql`select count(*)::int as n from realtime.messages where topic = 'admin:live'`);
    check("a platform admin can", admin.n > 0, String(admin.n));
    await run(sql`reset role`);

    throw new Rollback();
  });
} catch (error) {
  if (!(error instanceof Rollback)) throw error;
}

console.log("");
console.log("THE CHECK SCRIPTS' OWN SHOPS");
// A shop with nobody in it can only be known by its address, so every shop a
// script makes says "check-" in it. One that didn't put 81 made-up purchases
// on the live dashboard. A slug built from a constant (`${SLUG}`) is followed
// to where the constant is set. This script is the exception: everything it
// writes is rolled back, and its look-alike shops are unmarked on purpose.
const unmarked: string[] = [];
for (const file of readdirSync("scripts").filter((name) => /\.(m?[jt]s)$/.test(name) && name !== "admin-check.mts")) {
  const source = readFileSync(join("scripts", file), "utf8").split(/\r?\n/);
  const constants = new Map(
    source.flatMap((line) => {
      const match = line.match(/const (\w+) = (.*)$/);
      return match ? [[match[1], match[2]] as const] : [];
    })
  );
  source.forEach((line, index) => {
    if (!/insert into organizations/i.test(line)) return;
    const statement = source.slice(index, index + 3).join(" ");
    const followed = [...statement.matchAll(/\$\{(\w+)/g)].map((match) => constants.get(match[1]) ?? "");
    if (!/check-/.test([statement, ...followed].join(" "))) unmarked.push(`${file}:${index + 1}`);
  });
}
check("every shop a script makes is marked check-", unmarked.length === 0, unmarked.join(", "));

console.log("");
console.log("THE ACCOUNTS LIST");
const everyone = await listAccounts();
check("every account is listed, with how they sign in", everyone.length > 0 && everyone.every((account) => account.email && Array.isArray(account.providers)));
const testers = await listAccounts({ filter: "testers" });
check("the tester filter finds only testers", testers.every((account) => account.policy?.kind === "tester"));
const nobody = await listAccounts({ q: "no-such-person-anywhere" });
check("a search that matches nothing finds nothing", nobody.length === 0);

console.log("");
console.log(`${passed} passed, ${failures.length} failed (all rolled back)`);
if (failures.length) {
  for (const failure of failures) console.log(`  - ${failure}`);
  process.exitCode = 1;
}
process.exit();
