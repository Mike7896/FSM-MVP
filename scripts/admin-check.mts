/**
 * The admin dashboard's event log, checked against a real database.
 *
 * - **Each trigger writes the line it should** — a new business, a job, a quote
 *   started, sent (the first one a milestone), opened (once), won (the first
 *   one a milestone), a trial, a purchase, a cancellation, a payment, a bug
 *   report.
 * - **A check script's shop is marked test**, so it never counts.
 * - **Logging never breaks a write**: a bad line is swallowed.
 * - **Only admins can read it.**
 *
 * The whole run is one transaction that is rolled back at the end — the ledger
 * is append-only and can't be cleaned up any other way — so nothing it does is
 * kept, and nothing reaches the live dashboard.
 *
 *     npm run admin:check
 */

import { sql } from "drizzle-orm";

import { listAccounts } from "@/lib/admin/accounts";
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
    console.log("WHO CAN READ IT");
    await run(sql`select set_config('request.jwt.claims', ${JSON.stringify({ sub: "00000000-0000-4000-8000-000000000000", role: "authenticated" })}, true)`);
    await run(sql`set local role authenticated`);
    const [visible] = await run<{ n: number }>(sql`select count(*)::int as n from admin_events where organization_id = ${org.id}`);
    check("a signed-in stranger sees none of it", visible.n === 0, String(visible.n));
    await run(sql`reset role`);

    throw new Rollback();
  });
} catch (error) {
  if (!(error instanceof Rollback)) throw error;
}

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
