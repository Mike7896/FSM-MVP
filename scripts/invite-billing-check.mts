/**
 * Inviting someone with founding pricing and free months — and making a test
 * account — checked end to end against real Stripe.
 *
 *     npm run invite:check
 *
 * Runs the real code paths, not stand-ins: `inviteAccount` and
 * `createTestAccount` make real Supabase accounts; the business is set up the
 * way the app sets it up; checkout makes a real Checkout Session; and the
 * subscription that checkout would create is made in Stripe on a **test
 * clock**, so the free period really ends and the first charge really
 * happens, in Stripe's simulated time.
 *
 * - The invite's options land on the account (founding, free until).
 * - During the free period: Pro, and founding prices guaranteed at checkout.
 * - Choosing a plan early: the rest of the free time becomes the Stripe trial,
 *   the card is collected, and the price is the founding one.
 * - The trial: access stays, MRR waits, the 14-day guarantee waits.
 * - Moving the free date in the panel moves the Stripe trial.
 * - Reminders a week out and the day before, once each.
 * - The trial ends: Stripe charges the founding price, and ServiceClerk
 *   counts it as new MRR and opens the guarantee from that charge.
 * - A test account's free access works the same way; a tester who becomes a
 *   customer isn't cut off when their tester access ends.
 *
 * Refuses a live key. Cleans up after itself: its accounts, shops, Stripe
 * customers and test clock. Release switches it needs are put back as they were.
 */

import { eq, inArray, sql } from "drizzle-orm";

import { createTestAccount, expiredTesters, updatePolicy } from "@/lib/admin/accounts";
import { inviteAccount } from "@/lib/admin/invites";
import { db } from "@/lib/db";
import { billingReleases } from "@/lib/db/schema/membership";
import { stripeCustomers } from "@/lib/db/schema/billing";
import { compEndOf, readAccess } from "@/lib/membership/access";
import { startMembershipCheckout, trialEndFor } from "@/lib/membership/checkout";
import { foundingOfferFor } from "@/lib/membership/founding";
import { priceIdFor } from "@/lib/membership/prices";
import { reconcileSubscription } from "@/lib/membership/reconcile";
import { remindFreePeriodsEnding } from "@/lib/membership/sweep";
import { stripe } from "@/lib/stripe/server";
import { createAdminClient } from "@/lib/supabase/server";

const key = process.env.STRIPE_SECRET_KEY ?? "";
if (!key.startsWith("sk_test_") && !key.startsWith("rk_test_")) {
  console.error("invite:check only runs against a Stripe sandbox (sk_test_ key).");
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
const RUN = `invite-billing-check-${Date.now()}`;
const day = (offset: number, from = new Date()) => new Date(from.getTime() + offset * DAY).toISOString().slice(0, 10);

const users: string[] = [];
const shops: string[] = [];
let clockId: string | null = null;

// Whoever runs it acts as the first admin on record — the log names them.
const [owner] = await db.execute<{ user_id: string; email: string }>(sql`select user_id, email from platform_admins order by added_at limit 1`);
if (!owner) {
  console.error("invite:check needs a platform admin to act as.");
  process.exit(1);
}
const admin = { userId: owner.user_id, email: owner.email, owner: true };

/** The business, set up the way app/api/v1/organizations does it: the shop and its owner together. */
async function setUpBusiness(userId: string, name: string) {
  const id = await db.transaction(async (tx) => {
    const [org] = await tx.execute<{ id: string }>(
      sql`insert into organizations (name, slug, created_by) values (${name}, ${`${RUN}-${shops.length}`}, ${userId}) returning id`
    );
    await tx.execute(sql`insert into memberships (organization_id, user_id, role) values (${org.id}, ${userId}, 'owner')`);
    return org.id;
  });
  shops.push(id);
  return id;
}

async function waitForClock(id: string) {
  for (let i = 0; i < 90; i += 1) {
    const clock = await stripe().testHelpers.testClocks.retrieve(id);
    if (clock.status === "ready") return;
    if (clock.status === "internal_failure") throw new Error("Test clock failed to advance.");
    await new Promise((resolve) => setTimeout(resolve, 2000));
  }
  throw new Error("Test clock took too long to advance.");
}

// Pro has to be on sale to be chosen. Put back as it was afterwards.
const [proBefore] = await db.select().from(billingReleases).where(eq(billingReleases.key, "pro"));
await db
  .insert(billingReleases)
  .values({ key: "pro", enabled: true })
  .onConflictDoUpdate({ target: billingReleases.key, set: { enabled: true } });

try {
  console.log("\nTHE INVITE: FOUNDING MEMBER, A MONTH FREE");
  const freeUntil = day(30);
  const invited = await inviteAccount(
    admin,
    { email: `${RUN}@example.invalid`, fullName: "Igor Probe", founding: true, freeUntil, message: null, send: false },
    "http://localhost:3000"
  );
  users.push(invited.userId);
  const [policy] = await db.execute<{ comp_plan: boolean; access_until: string; kind: string }>(
    sql`select comp_plan, access_until::text, kind from account_policies where user_id = ${invited.userId}`
  );
  check("the free month is on their account, as an ordinary (not tester) account", policy?.comp_plan === true && policy.access_until === freeUntil && policy.kind === "standard", policy);
  const { data: authUser } = await createAdminClient().auth.admin.getUserById(invited.userId);
  check("founding pricing is on their account", authUser.user?.app_metadata?.founding_member === true);

  const shop = await setUpBusiness(invited.userId, "Probe Roofing");
  let access = await readAccess(shop);
  const freeEnds = compEndOf(freeUntil);
  check("while it's free, they have Pro", access.tier === "pro" && access.standing === "comp", { tier: access.tier, standing: access.standing });
  check("…and the dashboard knows when it ends", access.comp?.endsAt?.getTime() === freeEnds.getTime(), access.comp);
  const offer = await foundingOfferFor(shop);
  check("founding prices are guaranteed, whatever the public offer is doing", offer.eligible && "guaranteed" in offer && offer.guaranteed === true, offer);

  console.log("\nCHOOSING A PLAN DURING THE FREE MONTH");
  const checkout = await startMembershipCheckout({
    organizationId: shop,
    caller: { userId: invited.userId, email: invited.email },
    tier: "pro",
    interval: "month",
    packs: [],
  });
  check("checkout opens a real Stripe Checkout page", checkout.url.startsWith("https://checkout.stripe.com/"), checkout.url);
  check("the rest of the free month becomes the trial: first charge the day after it ends", checkout.trialEnd === Math.floor(freeEnds.getTime() / 1000), { trialEnd: checkout.trialEnd, expected: Math.floor(freeEnds.getTime() / 1000) });
  const sessionId = new URL(checkout.url).pathname.split("/").pop()?.split("#")[0] ?? "";
  const [started] = await db.execute<{ detail: { sessionId: string } }>(
    sql`select detail from billing_events where organization_id = ${shop} and kind = 'checkout.started' order by id desc limit 1`
  );
  const session = await stripe().checkout.sessions.retrieve(started.detail.sessionId ?? sessionId);
  const lines = await stripe().checkout.sessions.listLineItems(session.id, { expand: ["data.price"] });
  check("Stripe has it at the founding Pro price", lines.data.map((line) => line.price?.lookup_key).join() === "founder_pro_month_v1", lines.data.map((line) => line.price?.lookup_key));
  check("…and takes the card at checkout, though nothing is charged yet", session.payment_method_collection === "always" && session.mode === "subscription", { collection: session.payment_method_collection, mode: session.mode });
  await stripe().checkout.sessions.expire(session.id);

  console.log("\nTHE SUBSCRIPTION CHECKOUT CREATES — IN STRIPE'S SIMULATED TIME");
  const clock = await stripe().testHelpers.testClocks.create({ frozen_time: Math.floor(Date.now() / 1000), name: RUN });
  clockId = clock.id;
  const customer = await stripe().customers.create({ email: invited.email, test_clock: clock.id, metadata: { organizationId: shop } });
  const card = await stripe().paymentMethods.attach("pm_card_visa", { customer: customer.id });
  await stripe().customers.update(customer.id, { invoice_settings: { default_payment_method: card.id } });
  const subscription = await stripe().subscriptions.create({
    customer: customer.id,
    items: [{ price: await priceIdFor("founder_pro_month_v1"), quantity: 1 }],
    trial_end: trialEndFor(access, new Date(clock.frozen_time * 1000))!,
    metadata: { organizationId: shop, founding: "true" },
  });
  const trialing = await reconcileSubscription(subscription.id);
  access = await readAccess(shop);
  check("Stripe holds it as a trial", subscription.status === "trialing" && trialing?.subscriptionStatus === "trialing");
  check("they keep Pro through the trial, on a real subscription now", access.tier === "pro" && access.standing === "paid" && access.trialEndsAt?.getTime() === freeEnds.getTime(), { tier: access.tier, standing: access.standing, trialEndsAt: access.trialEndsAt });
  check("they're a founding member, with the price locked", access.founding.status === "enrolled" && access.founding.price === true, access.founding);
  const [mrrTrial] = await db.execute<{ mrr: number | null }>(sql`select mrr_cents as mrr from billing_accounts where organization_id = ${shop}`);
  check("a trial isn't MRR yet", (mrrTrial?.mrr ?? 0) === 0, mrrTrial);
  check("the 14-day guarantee hasn't started — nothing's been charged", access.refund.until === null && !access.refund.eligible, access.refund);

  console.log("\nMOVING THE FREE DATE FROM THE PANEL");
  const movedUntil = day(40);
  await updatePolicy(admin, invited.userId, { accessUntil: movedUntil });
  const moved = await stripe().subscriptions.retrieve(subscription.id);
  const movedEnds = compEndOf(movedUntil);
  check("Stripe's trial moves with it", moved.trial_end === Math.floor(movedEnds.getTime() / 1000), { trial_end: moved.trial_end, expected: Math.floor(movedEnds.getTime() / 1000) });

  console.log("\nREMINDERS");
  const at = (offset: number) => new Date(movedEnds.getTime() - DAY + offset * DAY + 12 * 3600_000);
  const weekOut = await remindFreePeriodsEnding(at(-6), { only: [shop] });
  const weekAgain = await remindFreePeriodsEnding(at(-5), { only: [shop] });
  const dayBefore = await remindFreePeriodsEnding(at(-1), { only: [shop] });
  const notices = [...(await db.execute<{ title: string; body: string }>(
    sql`select title, body from notifications where organization_id = ${shop} and kind = 'billing.notice' order by created_at`
  ))];
  check("a week out, once", weekOut === 1 && weekAgain === 0, { weekOut, weekAgain });
  check("…and the day before", dayBefore === 1 && notices.some((notice) => notice.title === "Your free time ends tomorrow"), notices.map((notice) => notice.title));
  check("having chosen a plan, they're told when it starts and that their card is charged then", notices.every((notice) => /membership starts .* card you added is charged then/.test(notice.body)), notices.map((notice) => notice.body));

  console.log("\nTHE FREE TIME ENDS");
  await stripe().testHelpers.testClocks.advance(clock.id, { frozen_time: Math.floor(movedEnds.getTime() / 1000) + 3 * 3600 });
  await waitForClock(clock.id);
  const invoices = (await stripe().invoices.list({ subscription: subscription.id, limit: 10 })).data;
  const firstCharge = invoices.find((invoice) => invoice.amount_paid > 0);
  check("Stripe charges the founding Pro price the day after", firstCharge?.status === "paid" && firstCharge.amount_paid === 3900, invoices.map((invoice) => ({ status: invoice.status, paid: invoice.amount_paid, reason: invoice.billing_reason })));
  const converted = await reconcileSubscription(subscription.id);
  access = await readAccess(shop);
  const [mrrPaid] = await db.execute<{ mrr: number | null }>(sql`select mrr_cents as mrr from billing_accounts where organization_id = ${shop}`);
  const [newMrr] = await db.execute<{ kind: string; to_cents: number }>(sql`select kind, to_cents from mrr_changes where organization_id = ${shop} order by id desc limit 1`);
  check("now an active, paid Pro membership", converted?.subscriptionStatus === "active" && access.standing === "paid" && access.tier === "pro" && access.trialEndsAt === null, { status: converted?.subscriptionStatus, standing: access.standing });
  check("…counted as $39 of new MRR the day it was charged", mrrPaid?.mrr === 3900 && newMrr?.kind === "new" && newMrr.to_cents === 3900, { mrrPaid, newMrr });
  const chargedAt = firstCharge?.status_transitions?.paid_at ? firstCharge.status_transitions.paid_at * 1000 : null;
  check(
    "…with the 14-day guarantee starting from that first charge",
    chargedAt !== null && access.refund.eligible && Math.abs((access.refund.until?.getTime() ?? 0) - (chargedAt + 14 * DAY)) < 60_000,
    { until: access.refund.until, chargedAt: chargedAt ? new Date(chargedAt) : null }
  );

  console.log("\nA TEST ACCOUNT");
  const testerUntil = day(14);
  const tester = await createTestAccount(admin, {
    email: `${RUN}-tester@example.invalid`,
    fullName: null,
    password: null,
    accessUntil: testerUntil,
    dailySendLimit: 5,
    compPlan: true,
    note: "invite:check",
  });
  users.push(tester.userId);
  const testerShop = await setUpBusiness(tester.userId, "Probe Plumbing");
  const testerAccess = await readAccess(testerShop);
  check("a tester's free access is Pro until their last day", testerAccess.tier === "pro" && testerAccess.comp?.endsAt?.getTime() === compEndOf(testerUntil).getTime(), testerAccess.comp);
  const testerCheckout = await startMembershipCheckout({
    organizationId: testerShop,
    caller: { userId: tester.userId, email: tester.email },
    tier: "starter",
    interval: "month",
    packs: [],
  });
  const [testerStarted] = await db.execute<{ detail: { sessionId: string } }>(
    sql`select detail from billing_events where organization_id = ${testerShop} and kind = 'checkout.started' order by id desc limit 1`
  );
  const testerLines = await stripe().checkout.sessions.listLineItems(testerStarted.detail.sessionId, { expand: ["data.price"] });
  check(
    "choosing a plan keeps the rest of their access free too, at public prices",
    testerCheckout.trialEnd === Math.floor(compEndOf(testerUntil).getTime() / 1000) && testerLines.data[0]?.price?.lookup_key === "core_starter_month_v1",
    { trialEnd: testerCheckout.trialEnd, price: testerLines.data[0]?.price?.lookup_key }
  );
  await stripe().checkout.sessions.expire(testerStarted.detail.sessionId);

  await db.execute(sql`update account_policies set access_until = current_date - 1 where user_id = ${tester.userId}`);
  const endingBefore = (await expiredTesters()).some((row) => row.userId === tester.userId);
  await db.execute(sql`insert into billing_accounts (organization_id, tier, interval, subscription_status, subscription_id)
    values (${testerShop}, 'starter', 'month', 'trialing', ${`sub_${RUN}`})
    on conflict (organization_id) do update set tier = 'starter', subscription_status = 'trialing', subscription_id = ${`sub_${RUN}`}`);
  const endingAfter = (await expiredTesters()).some((row) => row.userId === tester.userId);
  check("a tester whose access ran out is suspended…", endingBefore);
  check("…unless they became a customer", !endingAfter);

  console.log("\nTHE TWO-DAY FLOOR");
  const now = new Date();
  const soon = trialEndFor({ comp: { endsAt: new Date(now.getTime() + DAY) } }, now);
  check("with a day of free time left, the trial runs the 48+ hours Checkout requires", soon === Math.floor(now.getTime() / 1000) + 49 * 3600, soon);
  check("with none left, they're charged on the day", trialEndFor({ comp: { endsAt: new Date(now.getTime() - 1000) } }, now) === null);
} catch (error) {
  check("the run reached the end", false, error instanceof Error ? error.message : String(error));
  console.error(error);
} finally {
  // Stripe: the checkout customers, and the clock (which takes its customer and subscription with it).
  if (shops.length) {
    const customers = await db.select().from(stripeCustomers).where(inArray(stripeCustomers.organizationId, shops));
    for (const row of customers) await stripe().customers.del(row.stripeCustomerId).catch(() => undefined);
  }
  if (clockId) await stripe().testHelpers.testClocks.del(clockId).catch(() => undefined);
  for (const id of shops) {
    await db.transaction(async (tx) => {
      const [row] = await tx.execute<{ slug: string }>(sql`select slug from organizations where id = ${id}`);
      if (row?.slug.startsWith(RUN)) await tx.execute(sql`delete from organizations where id = ${id}`);
    });
  }
  for (const id of users) await createAdminClient().auth.admin.deleteUser(id).catch(() => undefined);
  if (proBefore) await db.update(billingReleases).set({ enabled: proBefore.enabled }).where(eq(billingReleases.key, "pro"));
  else await db.delete(billingReleases).where(eq(billingReleases.key, "pro"));
}

console.log(`\n${passed} passed, ${failures.length} failed (cleaned up)`);
if (failures.length) {
  for (const failure of failures) console.log(`  - ${failure}`);
  process.exitCode = 1;
}
process.exit();
