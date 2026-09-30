/**
 * The membership rules, held to the Launch Billing Specification.
 *
 *     npm run membership:check
 *
 * Pure rules first — fees, prices, access — then the parts that only mean
 * something against a real database: the Free job counter under a race, the
 * one-per-business evaluation, and the AI credit ledger. Stripe itself is
 * exercised by `npm run membership:scenarios`.
 *
 * Makes its own shops (slug `membership-check-…`) and removes them at the end.
 * Release switches it flips are put back as they were.
 */

import assert from "node:assert";
import type Stripe from "stripe";
import { eq, sql } from "drizzle-orm";

import { db } from "@/lib/db";
// Concrete modules rather than the barrel: tsx loads the library as CJS, where
// named-export detection cannot see through `export *`.
import { billingAccounts, billingReleases, type BillingAccount } from "@/lib/db/schema/membership";
import { organizations } from "@/lib/db/schema/office";
import { deriveAccess, type AccessInput } from "@/lib/membership/access";
import {
  ActivationLimitError,
  getActivationUsage,
  nextReset,
  periodOf,
  reserveActivation,
  releaseActivation,
  commitActivation,
  withActivation,
} from "@/lib/membership/activation";
import { PRICES, TIER_FEATURES, applicationFeeFor, coreLookupKey, packLookupKey } from "@/lib/membership/catalog";
import {
  creditBalance,
  creditWindow,
  expireCredits,
  recordCreditPurchase,
  releaseCredits,
  reserveCredits,
  revokeCreditPurchase,
  settleCredits,
} from "@/lib/membership/credits";
import { startEvaluation } from "@/lib/membership/evaluation";
import { monthlyRecurringCents } from "@/lib/membership/mrr";

let passed = 0;
const failures: string[] = [];

function check(label: string, condition: boolean, detail?: unknown) {
  if (condition) {
    passed += 1;
    console.log(`  ok   ${label}`);
  } else {
    const note = detail === undefined ? "" : ` — ${typeof detail === "string" ? detail : JSON.stringify(detail)}`;
    failures.push(`${label}${note}`);
    console.log(`  FAIL ${label}${note}`);
  }
}

async function refuses(label: string, run: () => Promise<unknown>, pattern?: RegExp | ((error: unknown) => boolean)) {
  try {
    await run();
    check(label, false, "it was allowed");
  } catch (error) {
    const ok = pattern === undefined
      ? true
      : pattern instanceof RegExp
        ? pattern.test(error instanceof Error ? error.message : String(error))
        : pattern(error);
    check(label, ok, error instanceof Error ? error.message : String(error));
  }
}

const DAY = 86_400_000;
const amount = (key: string) => PRICES.find((price) => price.lookupKey === key)!.amountCents;

/* ── §8.2 ACH fee ──────────────────────────────────────────────────────── */

console.log("\nHOMEOWNER PAYMENT FEES (§8.2)");
check("a card payment carries no ServiceClerk fee", applicationFeeFor("card", 500_000) === 0);
check("$100 by ACH → $0.20", applicationFeeFor("ach", 10_000) === 20);
check("$1,000 by ACH → $2.00", applicationFeeFor("ach", 100_000) === 200);
check("$5,000 by ACH → $5.00, the cap", applicationFeeFor("ach", 500_000) === 500);
check("$10,000 by ACH → still $5.00", applicationFeeFor("ach", 1_000_000) === 500);
check("0.2% rounds half up — $2.50 → 1¢", applicationFeeFor("ach", 250) === 1);
check("…and just under half rounds down — $2.49 → 0¢", applicationFeeFor("ach", 249) === 0);

/* ── §2.1 prices ───────────────────────────────────────────────────────── */

console.log("\nTHE PRICE CATALOG (§2.1, §6, §11.1)");
for (const [month, year] of [
  ["core_starter_month_v1", "core_starter_year_v1"],
  ["core_pro_month_v1", "core_pro_year_v1"],
  ["pack_electrical_month_v1", "pack_electrical_year_v1"],
  ["founder_starter_month_v1", "founder_starter_year_v1"],
  ["founder_pro_month_v1", "founder_pro_year_v1"],
]) {
  check(`${year} is exactly ten payments of ${month}`, amount(year) === amount(month) * 10);
}
const total = (tier: "starter" | "pro", interval: "month" | "year", founding = false) =>
  amount(coreLookupKey(tier, interval, founding)) + amount(packLookupKey("electrical", interval));
check("Starter + Electrical = $37/month", total("starter", "month") === 3700);
check("Pro + Electrical = $57/month", total("pro", "month") === 5700);
check("Starter + Electrical = $370/year", total("starter", "year") === 37000);
check("Pro + Electrical = $570/year", total("pro", "year") === 57000);
check("Founding Starter + Electrical = $27/month, $270/year", total("starter", "month", true) === 2700 && total("starter", "year", true) === 27000);
check("Founding Pro + Electrical = $47/month, $470/year", total("pro", "month", true) === 4700 && total("pro", "year", true) === 47000);
check("the annual saving on Starter + Electrical is $74", total("starter", "month") * 12 - total("starter", "year") === 7400);

/* ── MRR, as the admin dashboard counts it ─────────────────────────────── */

console.log("\nMONTHLY RECURRING REVENUE (admin dashboard)");
{
  const item = (unit_amount: number | null, interval: "month" | "year", quantity = 1) =>
    ({ quantity, price: { unit_amount, recurring: { interval, interval_count: 1, usage_type: "licensed" } } }) as unknown as Stripe.SubscriptionItem;
  const sub = (items: Stripe.SubscriptionItem[], discounts: unknown[] = []) =>
    ({ items: { data: items }, discounts }) as unknown as Pick<Stripe.Subscription, "items" | "discounts">;
  const off = (coupon: Partial<Stripe.Coupon>, end: number | null = null) => ({ end, source: { coupon } });
  check("Starter + Electrical monthly → $37", monthlyRecurringCents(sub([item(2900, "month"), item(800, "month")])) === 3700);
  check("Starter + Electrical yearly → $370 / 12", monthlyRecurringCents(sub([item(29000, "year"), item(8000, "year")])) === Math.round(37000 / 12));
  check("quantity counts", monthlyRecurringCents(sub([item(2900, "month", 2)])) === 5800);
  check("a forever 20% promo comes off", monthlyRecurringCents(sub([item(5000, "month")], [off({ duration: "forever", percent_off: 20 })])) === 4000);
  check("a repeating $10 off a yearly plan is $10/12 a month", monthlyRecurringCents(sub([item(29000, "year")], [off({ duration: "repeating", amount_off: 1000 })])) === Math.round((29000 - 1000) / 12));
  check("a once-only coupon doesn't lower MRR", monthlyRecurringCents(sub([item(2900, "month")], [off({ duration: "once", amount_off: 2900 })])) === 2900);
  check("an ended discount doesn't count", monthlyRecurringCents(sub([item(2900, "month")], [off({ duration: "repeating", percent_off: 50 }, 1)])) === 2900);
  check("never below zero", monthlyRecurringCents(sub([item(500, "month")], [off({ duration: "forever", amount_off: 900 })])) === 0);
  check("an unexpanded discount → unknown", monthlyRecurringCents(sub([item(2900, "month")], ["di_123"])) === null);
  check("a price with no flat amount → unknown", monthlyRecurringCents(sub([item(null, "month")])) === null);
}

/* ── §2.2, §4, §5.3 access ────────────────────────────────────────────── */

console.log("\nWHAT A SHOP MAY DO (§2.2, §4.1, §5.3)");
const now = new Date("2026-10-15T12:00:00Z");
const blankAccount = (over: Partial<BillingAccount>): BillingAccount => ({
  organizationId: "00000000-0000-0000-0000-000000000000",
  subscriptionId: null,
  subscriptionStatus: null,
  tier: "free",
  interval: null,
  packs: [],
  priceKeys: [],
  foundingPrice: false,
  currentPeriodStart: null,
  currentPeriodEnd: null,
  paidThrough: null,
  pastDueSince: null,
  unpaidInvoiceId: null,
  cancelAtPeriodEnd: false,
  endedAt: null,
  pendingChange: null,
  scheduledChange: null,
  scheduleId: null,
  firstPaidAt: null,
  refundedAt: null,
  paidAccessEndedAt: null,
  foundingStatus: "none",
  foundingHoldUntil: null,
  foundingHoldSession: null,
  foundingEnrolledAt: null,
  notices: [],
  reconciledAt: null,
  updatedAt: now,
  ...over,
});
const input = (account: BillingAccount | null, extra: Partial<AccessInput> = {}): AccessInput => ({
  organizationId: account?.organizationId ?? "org",
  account,
  evaluations: [],
  enablement: new Map(),
  comp: false,
  now,
  ...extra,
});
const paid = (tier: "starter" | "pro", over: Partial<BillingAccount> = {}) =>
  blankAccount({
    subscriptionId: "sub_x",
    subscriptionStatus: "active",
    tier,
    interval: "month",
    currentPeriodStart: new Date(now.getTime() - 5 * DAY),
    currentPeriodEnd: new Date(now.getTime() + 25 * DAY),
    paidThrough: new Date(now.getTime() + 25 * DAY),
    firstPaidAt: new Date(now.getTime() - 5 * DAY),
    ...over,
  });

{
  const free = deriveAccess(input(null));
  check("no membership is Free: 3 jobs a month, the footer, no branding", free.tier === "free" && free.features.monthlyActivations === 3 && free.features.promoFooter && !free.features.branding);
  check("Free has 1 GB of attachments", free.features.storageBytes === 1024 ** 3);

  const starter = deriveAccess(input(paid("starter")));
  check("a stale active status cannot grant access past paid-through", deriveAccess(input(paid("pro", { paidThrough: new Date(now.getTime() - DAY) }))).tier === "free");
  check("Starter: unlimited jobs, no footer, saved items — but no logo, views or analytics",
    starter.standing === "paid" && starter.features.monthlyActivations === null && !starter.features.promoFooter &&
    starter.features.savedItems && !starter.features.branding && !starter.features.viewTracking && !starter.features.analytics);

  const pro = deriveAccess(input(paid("pro")));
  check("Pro: logo, quote-view tracking, analytics, priority support, 25 GB",
    pro.features.branding && pro.features.viewTracking && pro.features.analytics && pro.features.prioritySupport && pro.features.storageBytes === 25 * 1024 ** 3);

  const withPack = deriveAccess(input(paid("starter", { packs: ["electrical"] })));
  check("a paid pack is entitled and shown", withPack.packs.electrical.entitled && withPack.packs.electrical.usable && withPack.packs.electrical.source === "subscription");

  const hidden = deriveAccess(input(paid("starter", { packs: ["electrical"] }), { enablement: new Map([["electrical", false]]) }));
  check("a hidden pack is still entitled — visibility never touches the bill (§4.1)", hidden.packs.electrical.entitled && !hidden.packs.electrical.usable && hidden.packs.electrical.purchased);

  const grace = deriveAccess(input(paid("pro", { subscriptionStatus: "past_due", pastDueSince: new Date(now.getTime() - 3 * DAY), packs: ["electrical"] })));
  check("a renewal 3 days unpaid is grace: Pro and the pack continue", grace.standing === "grace" && grace.tier === "pro" && grace.packs.electrical.entitled);
  check("…but nothing new can be bought during grace", !grace.canChangePlan);
  check("…and grace ends 7 days after the renewal fell due", grace.graceEndsAt?.getTime() === now.getTime() - 3 * DAY + 7 * DAY);

  const restricted = deriveAccess(input(paid("pro", { subscriptionStatus: "past_due", pastDueSince: new Date(now.getTime() - 8 * DAY), packs: ["electrical"] })));
  check("still unpaid after 7 days: Free rules, pack execution stops", restricted.standing === "restricted" && restricted.tier === "free" && !restricted.packs.electrical.entitled);

  const canceled = deriveAccess(input(paid("pro", { subscriptionStatus: "canceled" })));
  check("a canceled subscription is Free", canceled.tier === "free" && canceled.standing === "free");

  const incomplete = deriveAccess(input(paid("pro", { subscriptionStatus: "incomplete" })));
  check("an abandoned or incomplete first payment grants nothing (§5.3)", incomplete.tier === "free");

  const evaluating = deriveAccess(input(null, {
    evaluations: [{ organizationId: "org", packId: "electrical", startedAt: new Date(now.getTime() - 2 * DAY), expiresAt: new Date(now.getTime() + 12 * DAY), endedAt: null, startedBy: null, ownerEmail: null }],
  }));
  check("a Free shop evaluating Electrical is entitled to it, and nothing more (§3.2)",
    evaluating.packs.electrical.entitled && evaluating.packs.electrical.source === "evaluation" && evaluating.tier === "free" && evaluating.features.monthlyActivations === 3 && !evaluating.features.branding);

  const expired = deriveAccess(input(null, {
    evaluations: [{ organizationId: "org", packId: "electrical", startedAt: new Date(now.getTime() - 15 * DAY), expiresAt: new Date(now.getTime() - DAY), endedAt: null, startedBy: null, ownerEmail: null }],
  }));
  check("an expired evaluation stops pack access and counts as used", !expired.packs.electrical.entitled && expired.packs.electrical.evaluationUsed);

  const downgrading = deriveAccess(input(paid("pro", { packs: ["electrical"], scheduledChange: { effectiveAt: new Date(now.getTime() + 25 * DAY).toISOString(), tier: "starter", interval: "month", packs: [] } })));
  check("a scheduled removal keeps the pack until the renewal (§4.2)", downgrading.packs.electrical.entitled && downgrading.packs.electrical.endsAt?.getTime() === now.getTime() + 25 * DAY);
  check("…and a scheduled downgrade keeps Pro until then", downgrading.tier === "pro");

  const cancelling = deriveAccess(input(paid("starter", { packs: ["electrical"], cancelAtPeriodEnd: true, scheduledChange: { effectiveAt: new Date(now.getTime() + 25 * DAY).toISOString(), tier: null, interval: null, packs: [] } })));
  check("cancelling the core ends every pack with it — no orphaned pack bill", cancelling.packs.electrical.endsAt !== null);

  const comp = deriveAccess(input(null, { comp: true }));
  check("a complimentary account is treated as Pro", comp.tier === "pro" && comp.standing === "comp");

  const refundable = deriveAccess(input(paid("starter")));
  check("five days after the first purchase, the 14-day refund is open", refundable.refund.eligible);
  const late = deriveAccess(input(paid("starter", { firstPaidAt: new Date(now.getTime() - 15 * DAY) })));
  check("fifteen days after, it has closed", !late.refund.eligible);
  const used = deriveAccess(input(paid("starter", { refundedAt: new Date(now.getTime() - 400 * DAY) })));
  check("once used, never again", !used.refund.eligible);

  const restorable = deriveAccess(input(blankAccount({ foundingStatus: "enrolled", subscriptionId: "sub_old", subscriptionStatus: "canceled", paidAccessEndedAt: new Date(now.getTime() - 10 * DAY) })));
  check("a founding member who left 10 days ago can still come back at founding prices", restorable.founding.status === "enrolled" && restorable.founding.restorableUntil !== null);
  const gone = deriveAccess(input(blankAccount({ foundingStatus: "enrolled", subscriptionId: "sub_old", subscriptionStatus: "canceled", paidAccessEndedAt: new Date(now.getTime() - 31 * DAY) })));
  check("…31 days later, founding status has lapsed", gone.founding.status === "lapsed");
}

/* ── §3.1 the Free job counter ───────────────────────────────────────── */

console.log("\nFREE JOB ACTIVATIONS (§3.1)");
check("periods are UTC calendar months", periodOf(new Date("2026-10-31T23:30:00-05:00")) === "2026-11");
check("the reset is midnight UTC on the 1st", nextReset(new Date("2026-10-15T00:00:00Z")).toISOString() === "2026-11-01T00:00:00.000Z");

const SLUG = `membership-check-${Date.now()}`;
const [org] = await db.execute<{ id: string }>(sql`insert into organizations (name, slug) values ('Membership Check', ${SLUG}) returning id`);
const [other] = await db.execute<{ id: string }>(sql`insert into organizations (name, slug) values ('Membership Check Two', ${`${SLUG}-two`}) returning id`);
const previousRelease = await db.select().from(billingReleases).where(eq(billingReleases.key, "pack_electrical"));

async function makeJob(organizationId: string, name: string, demo = false) {
  const [customer] = await db.execute<{ id: string }>(sql`insert into customers (organization_id, name) values (${organizationId}, ${`${name} customer`}) returning id`);
  const [job] = await db.execute<{ id: string }>(sql`insert into jobs (organization_id, customer_id, name, is_demo) values (${organizationId}, ${customer.id}, ${name}, ${demo}) returning id`);
  return job.id;
}

try {
  const jobs = await Promise.all(["One", "Two", "Three", "Four", "Five"].map((name) => makeJob(org.id, name)));

  await withActivation({ organizationId: org.id, jobId: jobs[0], action: "quote_sent" }, async () => undefined);
  let usage = await getActivationUsage(org.id);
  check("a Free shop sends a quote → one activated job", usage.used === 1 && usage.limit === 3);

  for (const action of ["quote_sent", "invoice_sent", "contract_sent", "pdf"] as const) {
    await withActivation({ organizationId: org.id, jobId: jobs[0], action }, async () => undefined);
  }
  usage = await getActivationUsage(org.id);
  check("revisions, deposits and the final bill on that job cost nothing more", usage.used === 1);

  await refuses(
    "a send that fails gives its slot back",
    () => withActivation({ organizationId: org.id, jobId: jobs[1], action: "invoice_sent" }, async () => { throw new Error("email bounced"); }),
    /email bounced/
  );
  usage = await getActivationUsage(org.id);
  check("…so the count is still one", usage.used === 1);

  const demo = await makeJob(org.id, "Practice", true);
  await withActivation({ organizationId: org.id, jobId: demo, action: "quote_sent" }, async () => undefined);
  check("a demo job never takes a slot", (await getActivationUsage(org.id)).used === 1);

  await withActivation({ organizationId: org.id, jobId: jobs[1], action: "invoice_sent" }, async () => undefined);
  check("an invoice-first job counts once, like any other", (await getActivationUsage(org.id)).used === 2);

  // Two different jobs race for the last slot.
  const race = await Promise.allSettled([
    reserveActivation({ organizationId: org.id, jobId: jobs[2], action: "quote_sent" }),
    reserveActivation({ organizationId: org.id, jobId: jobs[3], action: "quote_sent" }),
  ]);
  const won = race.filter((result) => result.status === "fulfilled");
  const lost = race.filter((result) => result.status === "rejected");
  check("two sends racing for the last Free slot: exactly one gets it", won.length === 1 && lost.length === 1);
  check("…and the other is told why, with the reset date",
    lost[0]?.status === "rejected" && lost[0].reason instanceof ActivationLimitError && (lost[0].reason.details as { reason: string }).reason === "free_limit");
  for (const result of won) if (result.status === "fulfilled") await commitActivation(result.value);

  await refuses(
    "the fourth distinct job in a month is refused",
    () => withActivation({ organizationId: org.id, jobId: jobs[4], action: "quote_sent" }, async () => undefined),
    (error) => error instanceof ActivationLimitError
  );

  const winner = won[0]?.status === "fulfilled" ? won[0].value : null;
  if (winner && winner.kind !== "exempt") {
    await db.execute(sql`delete from jobs where id = ${winner.jobId}`);
    check("deleting an activated job doesn't hand its slot back", (await getActivationUsage(org.id)).used === 3);
  }

  // A paid shop is unlimited — and still counted.
  await db.insert(billingAccounts).values({
    organizationId: org.id,
    subscriptionId: `sub_check_${Date.now()}`,
    subscriptionStatus: "active",
    tier: "starter",
    interval: "month",
    paidThrough: new Date(Date.now() + 20 * DAY),
    currentPeriodEnd: new Date(Date.now() + 20 * DAY),
  });
  await withActivation({ organizationId: org.id, jobId: jobs[4], action: "quote_sent" }, async () => undefined);
  usage = await getActivationUsage(org.id);
  check("a paid shop has no volume gate, and its activations are still recorded", usage.limit === null && usage.used === 4);

  // …then it cancels mid-month.
  await db.update(billingAccounts).set({ subscriptionStatus: "canceled", tier: "free" }).where(eq(billingAccounts.organizationId, org.id));
  const extra = await makeJob(org.id, "After cancelling");
  await refuses(
    "after cancelling with 4 activations this month, no new Free job until the reset",
    () => withActivation({ organizationId: org.id, jobId: extra, action: "quote_sent" }, async () => undefined),
    (error) => error instanceof ActivationLimitError
  );
  await withActivation({ organizationId: org.id, jobId: jobs[0], action: "invoice_sent" }, async () => undefined);
  check("…while a job already activated still invoices and collects", true);

  const stale = await reserveActivation({ organizationId: other.id, jobId: await makeJob(other.id, "Stale"), action: "pdf" });
  if (stale.kind === "reserved") {
    await refuses("a second send cannot borrow an in-flight reservation", () => reserveActivation({ organizationId: other.id, jobId: stale.jobId, action: "payment" }), /already being published/);
  }
  await releaseActivation(stale);
  check("a released reservation leaves nothing behind", (await getActivationUsage(other.id)).used === 0);

  /* ── §3.2 evaluation ─────────────────────────────────────────────────── */

  console.log("\nTHE 14-DAY EVALUATION (§3.2)");
  await db.insert(billingReleases).values({ key: "pack_electrical", enabled: false }).onConflictDoUpdate({ target: billingReleases.key, set: { enabled: false } });
  await refuses("not while the pack is unreleased", () => startEvaluation({ organizationId: other.id, pack: "electrical", userId: "00000000-0000-0000-0000-000000000000", ownerEmail: `${SLUG}@check.test` }), /isn't available/);

  await db.update(billingReleases).set({ enabled: true }).where(eq(billingReleases.key, "pack_electrical"));
  const started = await startEvaluation({ organizationId: other.id, pack: "electrical", userId: "00000000-0000-0000-0000-000000000000", ownerEmail: `${SLUG}@check.test` });
  check("it runs exactly 14 × 24 hours", started.expiresAt.getTime() - started.startedAt.getTime() === 14 * DAY);
  await refuses("once per shop", () => startEvaluation({ organizationId: other.id, pack: "electrical", userId: "00000000-0000-0000-0000-000000000000", ownerEmail: `${SLUG}@check.test` }), /already used/);
  await refuses("once per business — a recreated account under the same owner is refused", () => startEvaluation({ organizationId: org.id, pack: "electrical", userId: "00000000-0000-0000-0000-000000000000", ownerEmail: `${SLUG.toUpperCase()}@CHECK.TEST` }), /already used/);

  /* ── §7 AI credits ───────────────────────────────────────────────────── */

  console.log("\nTHE AI CREDIT LEDGER (§7)");
  const window = creditWindow(new Date("2026-01-31T10:00:00Z"), new Date("2026-02-28T12:00:00Z"));
  check("a window anchored on the 31st falls on the last day of a short month", window.start.toISOString().startsWith("2026-02-28"));
  check("…and runs to the next anniversary", window.end.toISOString().startsWith("2026-03-31"));

  const credits = other.id;
  await db.execute(sql`insert into ai_credit_entries (organization_id, kind, credits, window_key, expires_at, note)
    values (${credits}, 'grant', 500, '2026-check', ${new Date(Date.now() + 10 * DAY).toISOString()}::timestamptz, 'check grant')`);
  await recordCreditPurchase({ organizationId: credits, paymentIntentId: `pi_${SLUG}`, credits: 1000, amountCents: 1000 });
  await recordCreditPurchase({ organizationId: credits, paymentIntentId: `pi_${SLUG}`, credits: 1000, amountCents: 1000 });
  check("a top-up recorded twice is credited once", (await creditBalance(credits)).purchased === 1000);

  await reserveCredits({ organizationId: credits, operationId: "op-1", action: "quote_draft" });
  await reserveCredits({ organizationId: credits, operationId: "op-1", action: "quote_draft" });
  check("a retried reservation reuses the operation — 20 credits, not 40", (await creditBalance(credits)).total === 1480);
  check("included credits are spent first", (await creditBalance(credits)).included === 480 && (await creditBalance(credits)).purchased === 1000);

  await releaseCredits(credits, "op-1");
  await releaseCredits(credits, "op-1");
  check("a failed call releases its reservation once", (await creditBalance(credits)).total === 1500);

  await reserveCredits({ organizationId: credits, operationId: "op-2", action: "follow_up_draft" });
  await settleCredits(credits, "op-2");
  await settleCredits(credits, "op-2");
  await releaseCredits(credits, "op-2");
  check("a settled action is charged once and can't be released after", (await creditBalance(credits)).total === 1495);

  await expireCredits(credits, new Date(Date.now() + 11 * DAY));
  const afterExpiry = await creditBalance(credits, new Date(Date.now() + 11 * DAY));
  check("included credits expire with their window; purchased ones don't", afterExpiry.included === 0 && afterExpiry.purchased === 1000);

  const revoked = await revokeCreditPurchase(credits, `pi_${SLUG}`);
  check("refunding a top-up removes its unused credits first", revoked.revoked === 1000 && (await creditBalance(credits)).purchased === 0);
  check("…and says what they cost — $10.00 for 1,000 unused", revoked.refundableCents === 1000);

  await refuses("no negative balance, no overage", () => reserveCredits({ organizationId: credits, operationId: "op-3", action: "quote_draft", now: new Date(Date.now() + 11 * DAY) }), /needs 20 credits/);
} finally {
  if (previousRelease.length) {
    await db.update(billingReleases).set({ enabled: previousRelease[0].enabled, config: previousRelease[0].config }).where(eq(billingReleases.key, "pack_electrical"));
  } else {
    await db.delete(billingReleases).where(eq(billingReleases.key, "pack_electrical"));
  }
  for (const id of [org.id, other.id]) {
    await db.transaction(async (tx) => {
      const [row] = await tx.select().from(organizations).where(eq(organizations.id, id));
      assert.ok(row?.slug.startsWith(SLUG), "Cleanup must target only this script's shops");
      await tx.execute(sql`delete from job_activations where organization_id = ${id}`);
      await tx.execute(sql`delete from ledger_entries where organization_id = ${id}`);
      await tx.delete(organizations).where(eq(organizations.id, id));
    });
  }
}

console.log(`\n${passed} passed, ${failures.length} failed`);
if (failures.length) {
  for (const failure of failures) console.log(`  - ${failure}`);
  process.exitCode = 1;
}
process.exit();

void TIER_FEATURES;
