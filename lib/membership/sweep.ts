import "server-only";

import { and, eq, gt, inArray, isNotNull, isNull, lt, or } from "drizzle-orm";

import { db } from "@/lib/db";
import { adminEvents, billingAccounts, billingEvents, packEvaluations } from "@/lib/db/schema";
import { stripe } from "@/lib/stripe/server";

import { DAY_MS, PACK_LABEL, POLICY, type PackId } from "./catalog";
import { expireCredits, organizationsWithCredits } from "./credits";
import { sendNotice } from "./notices";
import { reconcileSubscription } from "./reconcile";

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
      console.error(`[membership] sweep couldn't reconcile ${before.subscriptionId}:`, error);
      return null;
    });
    report.reconciled += 1;
    if (after && (after.subscriptionStatus !== before.subscriptionStatus || after.tier !== before.tier || after.packs.join() !== before.packs.join())) {
      // Our copy disagreed with Stripe — an event went missing. Say so (§11.2).
      report.diverged.push(before.organizationId);
      await db.insert(adminEvents).values({
        kind: "billing.divergence",
        level: "problem",
        organizationId: before.organizationId,
        title: `Billing was out of step with Stripe (${before.subscriptionStatus} → ${after.subscriptionStatus}) and has been corrected.`,
      }).catch(() => undefined);
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

  return report;
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
        console.error(`[membership] couldn't void ${invoiceId}; re-reading instead:`, error);
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
