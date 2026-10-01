/**
 * The Launch Billing Specification's sandbox acceptance scenarios (§13),
 * against real Stripe.
 *
 *     npm run membership:scenarios
 *
 * Each scenario gets its own shop, its own Stripe customer and its own **test
 * clock**, so renewals, failed payments and prorations happen in Stripe's
 * simulated time rather than being assumed. What is checked is what Stripe
 * actually invoiced and what ServiceClerk then derived — never a local total.
 *
 * Refuses a live key. Leaves its test clocks in the sandbox for inspection
 * (Stripe removes them on its own); removes its shops from the database.
 * Release switches it turns on are put back as they were.
 */

import assert from "node:assert";
import type Stripe from "stripe";
import { eq, inArray, sql } from "drizzle-orm";

import { db } from "@/lib/db";
import { billingAccounts, billingReleases } from "@/lib/db/schema/membership";
import { stripeCustomers } from "@/lib/db/schema/billing";
import { organizations } from "@/lib/db/schema/office";
import { readAccess } from "@/lib/membership/access";
import { applyChange, cancelMembership, nextConfig, previewChange, resumeMembership } from "@/lib/membership/changes";
import { reconcileFrom, reconcileSubscription } from "@/lib/membership/reconcile";
import { refundFirstPurchase } from "@/lib/membership/refund";
import { runMembershipSweep } from "@/lib/membership/sweep";
import { stripe } from "@/lib/stripe/server";

const key = process.env.STRIPE_SECRET_KEY ?? "";
if (!key.startsWith("sk_test_") && !key.startsWith("rk_test_")) {
  console.error("membership:scenarios only runs against a Stripe sandbox (sk_test_ key).");
  process.exit(1);
}

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

const DAY = 86_400_000;
const RUN = `membership-scenarios-${Date.now()}`;
const orgIds: string[] = [];
const prices = new Map<string, string>();

async function priceId(lookupKey: string) {
  if (!prices.has(lookupKey)) {
    const list = await stripe().prices.list({ lookup_keys: [lookupKey], active: true, limit: 1 });
    assert.ok(list.data[0], `No price for ${lookupKey} — run npm run stripe:seed`);
    prices.set(lookupKey, list.data[0].id);
  }
  return prices.get(lookupKey)!;
}

type Shop = { organizationId: string; customerId: string; clockId: string; card: string };

async function shop(name: string): Promise<Shop> {
  const [org] = await db.execute<{ id: string }>(
    sql`insert into organizations (name, slug) values (${name}, ${`${RUN}-${orgIds.length}`}) returning id`
  );
  orgIds.push(org.id);
  const clock = await stripe().testHelpers.testClocks.create({
    frozen_time: Math.floor(Date.now() / 1000),
    name: `${RUN} ${name}`.slice(0, 300),
  });
  const customer = await stripe().customers.create({
    name,
    email: `${RUN}-${orgIds.length}@example.com`,
    test_clock: clock.id,
    metadata: { organizationId: org.id },
  });
  const card = await stripe().paymentMethods.attach("pm_card_visa", { customer: customer.id });
  await stripe().customers.update(customer.id, { invoice_settings: { default_payment_method: card.id } });
  await db.insert(stripeCustomers).values({ organizationId: org.id, stripeCustomerId: customer.id });
  return { organizationId: org.id, customerId: customer.id, clockId: clock.id, card: card.id };
}

async function clockNow(shop: Shop) {
  const clock = await stripe().testHelpers.testClocks.retrieve(shop.clockId);
  return new Date(clock.frozen_time * 1000);
}

async function advance(shop: Shop, to: Date) {
  await stripe().testHelpers.testClocks.advance(shop.clockId, { frozen_time: Math.floor(to.getTime() / 1000) });
  for (let i = 0; i < 90; i += 1) {
    const clock = await stripe().testHelpers.testClocks.retrieve(shop.clockId);
    if (clock.status === "ready") return;
    if (clock.status === "internal_failure") throw new Error("Test clock failed to advance.");
    await new Promise((resolve) => setTimeout(resolve, 2000));
  }
  throw new Error("Test clock took too long to advance.");
}

async function subscribe(shop: Shop, keys: string[]) {
  const subscription = await stripe().subscriptions.create({
    customer: shop.customerId,
    items: await Promise.all(keys.map(async (lookup) => ({ price: await priceId(lookup), quantity: 1 }))),
    metadata: { organizationId: shop.organizationId },
    payment_behavior: "error_if_incomplete",
    expand: ["latest_invoice"],
  });
  await reconcileSubscription(subscription.id);
  return subscription;
}

async function lookupKeysOf(subscriptionId: string) {
  const subscription = await stripe().subscriptions.retrieve(subscriptionId);
  return subscription.items.data.map((item) => item.price.lookup_key).sort();
}

async function useFailingCard(shop: Shop, subscriptionId: string) {
  const failing = await stripe().paymentMethods.attach("pm_card_chargeCustomerFail", { customer: shop.customerId });
  await stripe().customers.update(shop.customerId, { invoice_settings: { default_payment_method: failing.id } });
  await stripe().subscriptions.update(subscriptionId, { default_payment_method: failing.id });
}

async function invoicesOf(subscriptionId: string) {
  return (await stripe().invoices.list({ subscription: subscriptionId, limit: 100 })).data;
}

/** `ONLY=FOUNDER npm run membership:scenarios` runs the scenarios whose title contains it. */
const ONLY = process.env.ONLY?.toUpperCase();

async function scenario(title: string, run: () => Promise<void>) {
  if (ONLY && !title.includes(ONLY)) return;
  console.log(`\n${title}`);
  try {
    await run();
  } catch (error) {
    check(`${title} ran to the end`, false, error instanceof Error ? error.message : String(error));
    console.error(error);
  }
}

// Sell what the scenarios need, for the length of the run.
const RELEASES = ["pro", "pack_electrical", "founding_offer"] as const;
const before = await db.select().from(billingReleases).where(inArray(billingReleases.key, [...RELEASES]));
for (const release of RELEASES) {
  await db
    .insert(billingReleases)
    .values({ key: release, enabled: true, config: release === "founding_offer" ? { launchedAt: new Date().toISOString() } : null })
    .onConflictDoUpdate({ target: billingReleases.key, set: { enabled: true } });
}

try {
  await scenario("STARTER + ELECTRICAL CHECKOUT — $37, two items, one subscription", async () => {
    const s = await shop("Starter Electrical");
    const subscription = await subscribe(s, ["core_starter_month_v1", "pack_electrical_month_v1"]);
    const invoice = subscription.latest_invoice as Stripe.Invoice;
    check("the first invoice is $37 before tax", invoice.subtotal === 3700, invoice.subtotal);
    check("one subscription holds both recurring items", subscription.items.data.length === 2);
    const access = await readAccess(s.organizationId);
    check("Starter and Electrical are granted once it's paid", access.standing === "paid" && access.tier === "starter" && access.packs.electrical.entitled);
  });

  await scenario("ANNUAL STARTER + ELECTRICAL — $370 upfront, matching intervals", async () => {
    const s = await shop("Annual");
    const subscription = await subscribe(s, ["core_starter_year_v1", "pack_electrical_year_v1"]);
    check("the first invoice is $370 before tax", (subscription.latest_invoice as Stripe.Invoice).subtotal === 37000);
    check("both items bill yearly", subscription.items.data.every((item) => item.price.recurring?.interval === "year"));
    check("the shop is annual", (await readAccess(s.organizationId)).interval === "year");
  });

  await scenario("MID-PERIOD PACK ADDITION — previewed proration charged once, access after payment", async () => {
    const s = await shop("Add pack");
    const subscription = await subscribe(s, ["core_starter_month_v1"]);
    const start = await clockNow(s);
    const periodEnd = new Date(subscription.items.data[0].current_period_end * 1000);
    const halfway = new Date(start.getTime() + (periodEnd.getTime() - start.getTime()) / 2);
    await advance(s, halfway);
    await reconcileSubscription(subscription.id);

    const target = { tier: "starter" as const, interval: "month" as const, packs: ["electrical" as const] };
    const preview = await previewChange(s.organizationId, target, halfway);
    check("adding Electrical halfway through costs about $4 now", preview.immediate !== null && Math.abs(preview.immediate.dueNowCents - 400) <= 15, preview.immediate?.dueNowCents);
    check("and the next full bill is $37", preview.renewalCents === 3700, preview.renewalCents);
    check("nothing waits for the renewal", preview.scheduled === null);

    const result = await applyChange({ organizationId: s.organizationId, target, prorationDate: preview.immediate!.prorationDate, actorUserId: s.organizationId, now: halfway });
    check("the change applied", result.status === "applied", result.status);
    const updates = (await invoicesOf(subscription.id)).filter((row) => row.billing_reason === "subscription_update");
    check("exactly one proration invoice, for the previewed amount", updates.length === 1 && updates[0].amount_due === preview.immediate!.dueNowCents, updates.map((row) => row.amount_due));
    check("Electrical is granted", (await readAccess(s.organizationId, halfway)).packs.electrical.purchased);
  });

  await scenario("STARTER + ELECTRICAL → PRO + ELECTRICAL HALFWAY — about $10 now, $57 at renewal", async () => {
    const s = await shop("Upgrade");
    const subscription = await subscribe(s, ["core_starter_month_v1", "pack_electrical_month_v1"]);
    const start = await clockNow(s);
    const periodEnd = new Date(subscription.items.data[0].current_period_end * 1000);
    const halfway = new Date(start.getTime() + (periodEnd.getTime() - start.getTime()) / 2);
    await advance(s, halfway);
    await reconcileSubscription(subscription.id);
    const target = { tier: "pro" as const, interval: "month" as const, packs: ["electrical" as const] };
    const preview = await previewChange(s.organizationId, target, halfway);
    check("about $10 now", preview.immediate !== null && Math.abs(preview.immediate.dueNowCents - 1000) <= 20, preview.immediate?.dueNowCents);
    check("renewal $57", preview.renewalCents === 5700, preview.renewalCents);
    await applyChange({ organizationId: s.organizationId, target, prorationDate: preview.immediate!.prorationDate, actorUserId: s.organizationId, now: halfway });
    const access = await readAccess(s.organizationId, halfway);
    check("Pro is granted after the payment, and the renewal date is kept", access.tier === "pro" && access.currentPeriodEnd?.getTime() === periodEnd.getTime());
  });

  await scenario("UPGRADE PAYMENT DECLINES — old access kept, Pro not granted", async () => {
    const s = await shop("Declined upgrade");
    const subscription = await subscribe(s, ["core_starter_month_v1"]);
    await useFailingCard(s, subscription.id);
    const now = await clockNow(s);
    const target = { tier: "pro" as const, interval: "month" as const, packs: [] };
    const preview = await previewChange(s.organizationId, target, new Date(now.getTime() + 60_000));
    const result = await applyChange({ organizationId: s.organizationId, target, prorationDate: preview.immediate!.prorationDate, actorUserId: s.organizationId, now: new Date(now.getTime() + 60_000) });
    check("the change waits for payment", result.status === "payment_required", result.status);
    const access = await readAccess(s.organizationId);
    check("the shop is still on Starter — nothing granted early", access.tier === "starter" && access.configuredTier === "starter");
    check("the pending change is recorded, and blocks another", access.pending !== null && !access.canChangePlan);
    check("Stripe kept the subscription on Starter", (await lookupKeysOf(subscription.id)).join() === "core_starter_month_v1");
  });

  await scenario("SCHEDULED DOWNGRADE, THEN A PACK — the new pack survives the renewal", async () => {
    const s = await shop("Downgrade then pack");
    const subscription = await subscribe(s, ["core_pro_month_v1"]);
    const now = new Date((await clockNow(s)).getTime() + 60_000);
    const down = await previewChange(s.organizationId, { tier: "starter", interval: "month", packs: [] }, now);
    check("Pro → Starter costs nothing now and waits for the renewal", down.immediate === null && down.scheduled?.config.tier === "starter");
    await applyChange({ organizationId: s.organizationId, target: { tier: "starter", interval: "month", packs: [] }, prorationDate: Math.floor(now.getTime() / 1000), actorUserId: s.organizationId, now });
    let access = await readAccess(s.organizationId, now);
    check("Pro continues until the renewal", access.tier === "pro" && access.scheduled?.tier === "starter");

    const next = nextConfig(access)!;
    const withPack = { ...next, packs: ["electrical" as const] };
    const later = new Date(now.getTime() + 2 * DAY);
    await advance(s, later);
    const preview = await previewChange(s.organizationId, withPack, later);
    check("adding Electrical is charged now", (preview.immediate?.dueNowCents ?? 0) > 0);
    check("…and the renewal becomes Starter + Electrical", preview.scheduled?.config.tier === "starter" && preview.scheduled.config.packs.includes("electrical"));
    await applyChange({ organizationId: s.organizationId, target: withPack, prorationDate: preview.immediate!.prorationDate, actorUserId: s.organizationId, now: later });

    const periodEnd = new Date(subscription.items.data[0].current_period_end * 1000);
    await advance(s, new Date(periodEnd.getTime() + 3 * 3600_000));
    await reconcileSubscription(subscription.id);
    check("after the renewal Stripe bills Starter + Electrical", (await lookupKeysOf(subscription.id)).join() === "core_starter_month_v1,pack_electrical_month_v1", await lookupKeysOf(subscription.id));
    access = await readAccess(s.organizationId, new Date(periodEnd.getTime() + 3 * 3600_000));
    check("and the shop is Starter with the pack", access.tier === "starter" && access.packs.electrical.purchased);
  });

  await scenario("FULL CANCELLATION — every pack stops with the core; undo works before the end", async () => {
    const s = await shop("Cancel");
    const subscription = await subscribe(s, ["core_starter_month_v1", "pack_electrical_month_v1"]);
    await cancelMembership(s.organizationId, s.organizationId);
    let access = await readAccess(s.organizationId);
    check("cancelling is scheduled for the period end, access kept until then", access.cancelAtPeriodEnd && access.tier === "starter" && access.packs.electrical.endsAt !== null);
    await resumeMembership(s.organizationId, s.organizationId);
    check("undoing it resumes the renewal", !(await readAccess(s.organizationId)).cancelAtPeriodEnd);
    await cancelMembership(s.organizationId, s.organizationId);

    const periodEnd = new Date(subscription.items.data[0].current_period_end * 1000);
    await advance(s, new Date(periodEnd.getTime() + 3 * 3600_000));
    await reconcileSubscription(subscription.id);
    access = await readAccess(s.organizationId, new Date(periodEnd.getTime() + 3 * 3600_000));
    check("at the end: Free, no pack, no pack bill", access.tier === "free" && !access.packs.electrical.entitled);
    const renewals = (await invoicesOf(subscription.id)).filter((row) => row.billing_reason === "subscription_cycle");
    check("no renewal invoice was created", renewals.length === 0, renewals.length);
  });

  await scenario("MONTHLY → ANNUAL — at the renewal, all prices together", async () => {
    const s = await shop("Interval switch");
    const subscription = await subscribe(s, ["core_starter_month_v1", "pack_electrical_month_v1"]);
    const now = new Date((await clockNow(s)).getTime() + 60_000);
    const target = { tier: "starter" as const, interval: "year" as const, packs: ["electrical" as const] };
    const preview = await previewChange(s.organizationId, target, now);
    check("nothing is charged now", preview.immediate === null);
    check("the next amount is $370", preview.renewalCents === 37000, preview.renewalCents);
    await applyChange({ organizationId: s.organizationId, target, prorationDate: Math.floor(now.getTime() / 1000), actorUserId: s.organizationId, now });
    const periodEnd = new Date(subscription.items.data[0].current_period_end * 1000);
    await advance(s, new Date(periodEnd.getTime() + 3 * 3600_000));
    await reconcileSubscription(subscription.id);
    check("Stripe now bills both yearly", (await lookupKeysOf(subscription.id)).join() === "core_starter_year_v1,pack_electrical_year_v1", await lookupKeysOf(subscription.id));
    // Changing interval restarts the billing cycle, so Stripe files this one
    // as an update rather than a cycle — it's the newest invoice either way.
    const [renewal] = await invoicesOf(subscription.id);
    check("the renewal invoice is $370", renewal?.subtotal === 37000, { subtotal: renewal?.subtotal, reason: renewal?.billing_reason });
  });

  await scenario("FOUNDER SWITCHES INTERVAL — founding core price, ordinary pack price", async () => {
    const s = await shop("Founder");
    const subscription = await subscribe(s, ["founder_starter_month_v1", "pack_electrical_month_v1"]);
    let access = await readAccess(s.organizationId);
    check("a paid founding checkout enrolls the shop", access.founding.status === "enrolled" && access.founding.price);
    check("…at $27 a month with Electrical", (subscription.latest_invoice as Stripe.Invoice).subtotal === 2700);
    const now = new Date((await clockNow(s)).getTime() + 60_000);
    const target = { tier: "starter" as const, interval: "year" as const, packs: ["electrical" as const] };
    const preview = await previewChange(s.organizationId, target, now);
    check("annual is $270 — founding $190 plus the ordinary $80 pack", preview.renewalCents === 27000, preview.renewalCents);
    await applyChange({ organizationId: s.organizationId, target, prorationDate: Math.floor(now.getTime() / 1000), actorUserId: s.organizationId, now });
    const periodEnd = new Date(subscription.items.data[0].current_period_end * 1000);
    await advance(s, new Date(periodEnd.getTime() + 3 * 3600_000));
    await reconcileSubscription(subscription.id);
    check("Stripe bills founder_starter_year + pack_electrical_year", (await lookupKeysOf(subscription.id)).join() === "founder_starter_year_v1,pack_electrical_year_v1", await lookupKeysOf(subscription.id));
    const [renewal] = await invoicesOf(subscription.id);
    check("…and charges $270 the day the annual year starts", renewal?.subtotal === 27000, { subtotal: renewal?.subtotal, reason: renewal?.billing_reason });
    access = await readAccess(s.organizationId, new Date(periodEnd.getTime() + 3 * 3600_000));
    check("founding status survives the switch", access.founding.status === "enrolled");
  });

  await scenario("RENEWAL UNPAID — 7 days' grace, then Free rules, then recovery", async () => {
    const s = await shop("Renewal fails");
    const subscription = await subscribe(s, ["core_pro_month_v1", "pack_electrical_month_v1"]);
    await useFailingCard(s, subscription.id);
    const periodEnd = new Date(subscription.items.data[0].current_period_end * 1000);
    const failedAt = new Date(periodEnd.getTime() + 3 * 3600_000);
    await advance(s, failedAt);
    await reconcileSubscription(subscription.id);

    let access = await readAccess(s.organizationId, failedAt);
    check("the failed renewal puts the shop in grace", access.standing === "grace", access.standing);
    check("previously purchased access continues in grace", access.tier === "pro" && access.packs.electrical.entitled);
    check("paid additions are blocked in grace", !access.canChangePlan);

    access = await readAccess(s.organizationId, new Date(failedAt.getTime() + 8 * DAY));
    check("still unpaid 8 days later: Free rules, the pack stops", access.standing === "restricted" && access.tier === "free" && !access.packs.electrical.entitled);

    const good = await stripe().paymentMethods.attach("pm_card_visa", { customer: s.customerId });
    await stripe().subscriptions.update(subscription.id, { default_payment_method: good.id });
    const [account] = await db.select().from(billingAccounts).where(eq(billingAccounts.organizationId, s.organizationId));
    if (account?.unpaidInvoiceId) await stripe().invoices.pay(account.unpaidInvoiceId, { payment_method: good.id });
    await reconcileSubscription(subscription.id);
    access = await readAccess(s.organizationId, failedAt);
    check("paying restores the paid configuration, once", access.standing === "paid" && access.tier === "pro" && access.packs.electrical.purchased);
  });

  await scenario("DAY 30 UNPAID — one financial outcome: void, cancel, Free", async () => {
    const s = await shop("Write-off");
    const subscription = await subscribe(s, ["founder_starter_month_v1"]);
    await useFailingCard(s, subscription.id);
    const periodEnd = new Date(subscription.items.data[0].current_period_end * 1000);
    await advance(s, new Date(periodEnd.getTime() + 3 * 3600_000));
    await reconcileSubscription(subscription.id);
    const [account] = await db.select().from(billingAccounts).where(eq(billingAccounts.organizationId, s.organizationId));
    check("the renewal is unpaid", Boolean(account?.pastDueSince && account.unpaidInvoiceId));

    const report = await runMembershipSweep(new Date(account!.pastDueSince!.getTime() + 31 * DAY));
    check("the sweep wrote it off", report.writtenOff.includes(s.organizationId), report);
    const invoice = await stripe().invoices.retrieve(account!.unpaidInvoiceId!);
    check("the unpaid renewal was voided, not left to collect", invoice.status === "void", invoice.status);
    const after = await stripe().subscriptions.retrieve(subscription.id);
    check("the subscription is canceled — no double subscription, no forgotten invoice", after.status === "canceled");
    const access = await readAccess(s.organizationId);
    check("the shop is Free, and founding status has lapsed", access.tier === "free" && access.founding.status === "lapsed");
  });

  await scenario("TINY PRORATION — below Stripe's minimum, it goes on the next bill", async () => {
    const s = await shop("Tiny proration");
    const subscription = await subscribe(s, ["core_starter_month_v1"]);
    const periodEnd = new Date(subscription.items.data[0].current_period_end * 1000);
    const almost = new Date(periodEnd.getTime() - 2 * 3600_000);
    await advance(s, almost);
    await reconcileSubscription(subscription.id);
    const target = { tier: "starter" as const, interval: "month" as const, packs: ["electrical" as const] };
    const preview = await previewChange(s.organizationId, target, almost);
    check("two hours before renewal, adding Electrical costs under 50¢", preview.immediate !== null && preview.immediate.dueNowCents < 50, preview.immediate?.dueNowCents);
    check("…so it's shown as added to the next bill", preview.immediate?.addedToNextBill === true || preview.immediate?.dueNowCents === 0);
    const result = await applyChange({ organizationId: s.organizationId, target, prorationDate: preview.immediate!.prorationDate, actorUserId: s.organizationId, now: almost });
    check("the pack is granted straight away for a shop in good standing", result.status === "applied" && (await readAccess(s.organizationId, almost)).packs.electrical.purchased, result.status);
    const updates = (await invoicesOf(subscription.id)).filter((row) => row.billing_reason === "subscription_update");
    check("recorded once — one update invoice", updates.length === 1, updates.length);
  });

  await scenario("14-DAY GUARANTEE — refunded, back to Free, once", async () => {
    const s = await shop("Guarantee");
    const subscription = await subscribe(s, ["founder_pro_month_v1", "pack_electrical_month_v1"]);
    const result = await refundFirstPurchase(s.organizationId, s.organizationId);
    check("the first purchase is refunded in full ($47)", result.refundedCents === 4700, result.refundedCents);
    const after = await stripe().subscriptions.retrieve(subscription.id);
    check("the subscription ends now, not at the period end", after.status === "canceled");
    const access = await readAccess(s.organizationId);
    check("the shop is Free, and founding enrollment is reversed", access.tier === "free" && access.founding.status === "reversed");
    try {
      await refundFirstPurchase(s.organizationId, s.organizationId);
      check("a second refund is refused", false);
    } catch {
      check("a second refund is refused", true);
    }
  });

  await scenario("DUPLICATE AND OUT-OF-ORDER EVENTS — no duplicate grant, no wrong revocation", async () => {
    const s = await shop("Out of order");
    const old = await subscribe(s, ["core_starter_month_v1"]);
    await stripe().subscriptions.cancel(old.id);
    await reconcileSubscription(old.id);
    const current = await subscribe(s, ["core_pro_month_v1"]);
    const staleOld = await stripe().subscriptions.retrieve(old.id, { expand: ["latest_invoice", "schedule.phases.items.price"] });
    await reconcileFrom(staleOld);
    await reconcileSubscription(current.id);
    await reconcileSubscription(current.id);
    const access = await readAccess(s.organizationId);
    check("a late event for the old, canceled subscription doesn't revoke the new one", access.tier === "pro" && access.subscriptionId === current.id);
    const events = await db.execute<{ n: number }>(sql`select count(*)::int as n from billing_events where organization_id = ${s.organizationId} and kind = 'membership.reconciled'`);
    check("reconciling the same state twice records no second change", events[0].n <= 4, events[0].n);
  });
} finally {
  for (const release of RELEASES) {
    const was = before.find((row) => row.key === release);
    if (was) await db.update(billingReleases).set({ enabled: was.enabled, config: was.config }).where(eq(billingReleases.key, release));
    else await db.delete(billingReleases).where(eq(billingReleases.key, release));
  }
  for (const id of orgIds) {
    await db.transaction(async (tx) => {
      const [row] = await tx.select().from(organizations).where(eq(organizations.id, id));
      assert.ok(row?.slug.startsWith(RUN), "Cleanup must target only this run's shops");
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
