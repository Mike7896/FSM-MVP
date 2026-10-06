import "server-only";

import { and, eq, gt, inArray, isNotNull, isNull, lt, or, sql } from "drizzle-orm";

import { db } from "@/lib/db";
import { billingAccounts, billingEvents, packEvaluations } from "@/lib/db/schema";
import { stripe } from "@/lib/stripe/server";

import { DAY_MS, PACK_LABEL, POLICY, TIER_LABEL, type PackId } from "./catalog";
import { expireCredits, organizationsWithCredits } from "./credits";
import { sendNotice } from "./notices";
import { reconcileSubscription } from "./reconcile";
import { recoverPlanChanges } from "./changes";
import { reportError } from "@/lib/observability";

/**
 * THE MEMBERSHIP SWEEP — the parts of the policy that are about time passing.
 *
 * Access never waits on this: grace, evaluation expiry and restoration windows
 * are all derived from timestamps when read. What does wait on it is *telling
 * people* (dunning on days 3 and 6, evaluation reminders on days 10 and 13),
 * the day-30 write-off, and the safety-net reconciliation that catches a
 * webhook Stripe never managed to deliver.
 *
 * Every step is idempotent — notices are keyed, the write-off re-reads Stripe
 * first — so running it twice, or late, is harmless.
 */

export type SweepReport = {
  reconciled: number;
  diverged: string[];
  notices: number;
  writtenOff: string[];
  skippedInFlight: string[];
};

export async function runMembershipSweep(now = new Date()): Promise<SweepReport> {
  await recoverPlanChanges(now);
  const report: SweepReport = { reconciled: 0, diverged: [], notices: 0, writtenOff: [], skippedInFlight: [] };

  /* ── 1. Missed events: reconcile anything live that hasn't been read in a day ── */
  const stale = await db
    .select()
    .from(billingAccounts)
    .where(
      and(
        isNotNull(billingAccounts.subscriptionId),
        inArray(billingAccounts.subscriptionStatus, ["active", "trialing", "past_due", "unpaid", "incomplete"]),
        or(isNull(billingAccounts.reconciledAt), lt(billingAccounts.reconciledAt, new Date(now.getTime() - DAY_MS)))
      )
    );

  for (const before of stale) {
    const after = await reconcileSubscription(before.subscriptionId!).catch((error) => {
      reportError(`[membership] sweep couldn't reconcile ${before.subscriptionId}:`, error);
      return null;
    });
    report.reconciled += 1;
    if (after && (after.subscriptionStatus !== before.subscriptionStatus || after.tier !== before.tier || after.packs.join() !== before.packs.join())) {
      // Our copy disagreed with Stripe — an event went missing. Say so (§11.2).
      report.diverged.push(before.organizationId);
      // Through admin_log, like every other line: it names the business and
      // knows a check script's shop from a real one.
      await db.execute(
        sql`select public.admin_log('billing.divergence', 'problem', ${before.organizationId}::uuid, null,
          ${`{org}'s billing was out of step with Stripe (${before.subscriptionStatus} → ${after.subscriptionStatus}) and has been corrected.`})`
      ).catch(() => undefined);
    }
  }

  /* ── 2. Unpaid renewals: notices, the grace line, the write-off (§5.3) ── */
  const unpaid = await db
    .select()
    .from(billingAccounts)
    .where(and(isNotNull(billingAccounts.pastDueSince), isNotNull(billingAccounts.subscriptionId)));

  for (const account of unpaid) {
    const since = account.pastDueSince!;
    const days = Math.floor((now.getTime() - since.getTime()) / DAY_MS);
    const invoice = account.unpaidInvoiceId ?? "renewal";

    for (const day of POLICY.dunningNoticeDays) {
      if (day === 0 || days < day) continue;
      const sent = await sendNotice(account.organizationId, {
        key: `dunning:${invoice}:${day}`,
        title: "Your ServiceClerk renewal is still unpaid",
        body: `We'll keep retrying your card. Paid features pause ${new Date(since.getTime() + POLICY.graceDays * DAY_MS).toLocaleDateString("en-US", { month: "long", day: "numeric", timeZone: "UTC" })} unless it's settled — your jobs, documents and customer payments are never affected.`,
      });
      if (sent) report.notices += 1;
    }

    if (days >= POLICY.graceDays) {
      const sent = await sendNotice(account.organizationId, {
        key: `dunning:${invoice}:restricted`,
        title: "Paid features are paused until your renewal is paid",
        body: "You're on Free rules for now. Everything you've built is here, and your customers can still pay you. Update your card and paid features come straight back.",
      });
      if (sent) report.notices += 1;
    }

    if (days >= POLICY.writeOffDays) {
      const outcome = await writeOff(account.organizationId, account.subscriptionId!, account.unpaidInvoiceId);
      if (outcome === "written_off") report.writtenOff.push(account.organizationId);
      if (outcome === "in_flight") report.skippedInFlight.push(account.organizationId);
    }
  }

  /* ── 3. Evaluations: day-10 and day-13 reminders (§3.2) ── */
  const running = await db
    .select()
    .from(packEvaluations)
    .where(and(isNull(packEvaluations.endedAt), gt(packEvaluations.expiresAt, now)));

  for (const evaluation of running) {
    const days = Math.floor((now.getTime() - evaluation.startedAt.getTime()) / DAY_MS);
    const name = PACK_LABEL[evaluation.packId as PackId] ?? evaluation.packId;
    for (const day of POLICY.evaluationReminderDays) {
      if (days < day) continue;
      const left = POLICY.evaluationDays - day;
      const sent = await sendNotice(evaluation.organizationId, {
        key: `eval:${evaluation.packId}:${day}`,
        title: `Your ${name} evaluation ends in ${left} day${left === 1 ? "" : "s"}`,
        body: `It stops on its own — nothing is charged. Quotes you've written with it stay exactly as they are. Add the ${name} pack to a paid plan to keep using it.`,
        href: `/office/packs/${evaluation.packId}`,
      });
      if (sent) report.notices += 1;
    }
  }

  /* ── 4. AI credits: included credits don't roll over (§7.1) ── */
  for (const organizationId of await organizationsWithCredits()) {
    await expireCredits(organizationId, now);
  }

  /* ── 5. Free periods ending: a week out, and the day before ── */
  report.notices += await remindFreePeriodsEnding(now);

  return report;
}

/** Days before a free period's last day that the shop is told it's ending. */
const FREE_REMINDER_DAYS = [7, 1] as const;

/**
 * A free period from the admin panel — an invite's free months, a tester's
 * access — is about to run out. The owner hears a week before and the day
 * before (or on the last day, if the sweep only gets there then), once each:
 * what happens next if they've chosen a plan, and how to choose one if not.
 * Keyed on the last day, so moving the date starts the reminders afresh.
 *
 * `only` narrows it to some shops — the check script, which runs it at
 * made-up dates and must never remind a real customer.
 */
export async function remindFreePeriodsEnding(
  now = new Date(),
  { only }: { only?: string[] } = {}
): Promise<number> {
  if (only && only.length === 0) return 0;
  const today = now.toISOString().slice(0, 10);
  const scope = only ? sql`and m.organization_id in (${sql.join(only.map((id) => sql`${id}::uuid`), sql`, `)})` : sql``;
  const rows = [
    ...(await db.execute<{
      organization_id: string;
      last_day: string;
      days_left: number;
      kind: string;
      status: string | null;
      tier: string | null;
    }>(sql`
      select m.organization_id, ap.access_until::text as last_day,
        (ap.access_until - ${today}::date)::int as days_left,
        ap.kind, b.subscription_status as status, b.tier
      from account_policies ap
      join memberships m on m.user_id = ap.user_id and m.role = 'owner'
      left join billing_accounts b on b.organization_id = m.organization_id
      where ap.comp_plan and ap.banned_at is null and ap.access_until is not null
        and ap.access_until between ${today}::date and ${today}::date + 7
        ${scope}
    `)),
  ];

  let sent = 0;
  for (const row of rows) {
    const lastDay = dayLabel(row.last_day);
    const firstCharge = dayLabel(new Date(Date.parse(`${row.last_day}T00:00:00Z`) + DAY_MS).toISOString().slice(0, 10));
    const when = row.days_left === 0 ? "today" : row.days_left === 1 ? "tomorrow" : `on ${lastDay}`;
    const chosen = row.status === "trialing" || row.status === "active";
    const plan = row.tier && row.tier !== "free" ? TIER_LABEL[row.tier as keyof typeof TIER_LABEL] : "your plan";
    const notice = chosen
      ? {
          title: `Your free time ends ${when}`,
          body: `Your ${plan} membership starts ${firstCharge}, and the card you added is charged then. You can change or cancel it in Billing before that.`,
        }
      : row.kind === "tester"
        ? {
            title: `Your ServiceClerk access ends ${when}`,
            body: `Choose a plan to keep your account going after ${lastDay} — nothing is charged until ${firstCharge}.`,
          }
        : {
            title: `Your free Pro ends ${when}`,
            body: `Choose a plan to keep going after ${lastDay} — nothing is charged until ${firstCharge}. If you don't, you'll move to Free, and everything you've made stays.`,
          };
    for (const threshold of FREE_REMINDER_DAYS) {
      if (row.days_left > threshold) continue;
      // The tighter reminder covers the wider one: a week out isn't news the day before.
      const key = `free:${row.last_day}:${threshold}`;
      if (threshold === 7 && row.days_left <= 1) continue;
      if (await sendNotice(row.organization_id, { key, ...notice, href: chosen ? "/account/billing" : "/account/billing/plan" })) sent += 1;
    }
  }
  return sent;
}

function dayLabel(day: string) {
  return new Date(`${day}T12:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
}

/**
 * Day 30 of an unpaid renewal (§5.3): stop retrying, void what was never
 * paid, return to Free. **One financial outcome** — the invoice is voided
 * before the subscription is cancelled, so a payment that lands in between
 * makes the void fail and the shop is restored instead of written off.
 */
async function writeOff(organizationId: string, subscriptionId: string, invoiceId: string | null) {
  const account = await reconcileSubscription(subscriptionId);
  if (!account || !account.pastDueSince) return "recovered";

  if (invoiceId) {
    const invoice = await stripe().invoices.retrieve(invoiceId, {
      expand: ["payments.data.payment.payment_intent"],
    });
    // A payment Stripe is still processing may yet succeed. Never cancel under it.
    const inFlight = (invoice.payments?.data ?? []).some((payment) => {
      const intent = payment.payment.payment_intent;
      return typeof intent !== "string" && intent?.status === "processing";
    });
    if (inFlight) return "in_flight";
    if (invoice.status === "paid") {
      await reconcileSubscription(subscriptionId);
      return "recovered";
    }
    if (invoice.status === "open") {
      try {
        await stripe().invoices.voidInvoice(invoiceId);
      } catch (error) {
        reportError(`[membership] couldn't void ${invoiceId}; re-reading instead:`, error);
        await reconcileSubscription(subscriptionId);
        return "recovered";
      }
    }
  }

  await stripe().subscriptions.cancel(subscriptionId, { prorate: false, invoice_now: false });
  await reconcileSubscription(subscriptionId);

  // Renewal failures not resolved within 30 days end founding status (§6).
  await db
    .update(billingAccounts)
    .set({ foundingStatus: "lapsed" })
    .where(and(eq(billingAccounts.organizationId, organizationId), eq(billingAccounts.foundingStatus, "enrolled")));

  await db.insert(billingEvents).values({
    organizationId,
    kind: "membership.written_off",
    detail: { subscriptionId, invoiceId },
  });

  await sendNotice(organizationId, {
    key: `writeoff:${subscriptionId}`,
    title: "Your ServiceClerk membership has ended",
    body: "The renewal stayed unpaid for 30 days, so we've stopped retrying and cleared the bill — you owe nothing. You're on Free now, with everything you built still here.",
  });
  return "written_off";
}
