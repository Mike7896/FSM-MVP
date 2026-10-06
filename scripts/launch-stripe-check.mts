/** Real Stripe sandbox: isolated test-clock customer, no shared release changes. */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import type Stripe from "stripe";
import { runPlanTransition, type PlanTransition, type TransitionPorts } from "../lib/membership/transition";
const key = process.env.STRIPE_SECRET_KEY ?? "";
if (!/^(sk|rk)_test_/.test(key)) throw new Error("This check requires a Stripe test key.");
const require = createRequire(import.meta.url);
const { stripe } = require("@/lib/stripe/server") as typeof import("@/lib/stripe/server");
const { writeSchedule } = require("@/lib/membership/changes") as typeof import("@/lib/membership/changes");
const { configOf } = require("@/lib/membership/reconcile") as typeof import("@/lib/membership/reconcile");
const { priceIdFor } = require("@/lib/membership/prices") as typeof import("@/lib/membership/prices");
const client = stripe();
const now = Math.floor(Date.now() / 1000);
let clockId: string | undefined;
try {
  const clock = await client.testHelpers.testClocks.create({ frozen_time: now, name: `Launch regression ${randomUUID()}` });
  clockId = clock.id;
  const customer = await client.customers.create({ name: "Launch regression fixture", test_clock: clock.id });
  const good = await client.paymentMethods.attach("pm_card_visa", { customer: customer.id });
  await client.customers.update(customer.id, { invoice_settings: { default_payment_method: good.id } });
  const starter = await priceIdFor("core_starter_month_v1");
  const pro = await priceIdFor("core_pro_month_v1");
  const sub = await client.subscriptions.create({ customer: customer.id, items: [{ price: starter }], payment_behavior: "error_if_incomplete" });
  const prior = { tier: "starter" as const, interval: "year" as const, packs: [] };
  await writeSchedule(sub.id, prior, false);
  const failed = await client.paymentMethods.attach("pm_card_chargeCustomerFail", { customer: customer.id });
  await client.customers.update(customer.id, { invoice_settings: { default_payment_method: failed.id } });
  await client.subscriptions.update(sub.id, { default_payment_method: failed.id });
  let durable: PlanTransition = {
    id: randomUUID(), subscriptionId: sub.id, target: { tier: "pro", interval: "year", packs: [] },
    immediate: { tier: "pro", interval: "month", packs: [] }, scheduled: { tier: "pro", interval: "year", packs: [] },
    previous: prior, previousCancel: false, founding: false, prorationDate: now,
    periodEnd: sub.items.data[0].current_period_end, phase: "prepared", invoiceUrl: null,
    update: { items: [{ id: sub.items.data[0].id, price: pro }], proration_behavior: "always_invoice", proration_date: now, payment_behavior: "error_if_incomplete", expand: ["latest_invoice"] },
  };
  let loseScheduleResponse = false;
  const ports: TransitionPorts = {
    save: async state => { durable = structuredClone(state); },
    read: async () => {
      const fresh = await client.subscriptions.retrieve(sub.id, { expand: ["schedule", "latest_invoice"] });
      const config = configOf(fresh.items.data.map(item => item.price));
      assert.ok(config.tier && config.interval);
      return { config: { tier: config.tier, interval: config.interval, packs: config.packs },
        pending: Boolean(fresh.pending_update), ended: fresh.status === "canceled",
        scheduleId: typeof fresh.schedule === "string" ? fresh.schedule : fresh.schedule?.id ?? null,
        invoiceUrl: typeof fresh.latest_invoice === "object" ? fresh.latest_invoice?.hosted_invoice_url ?? null : null };
    },
    release: async id => { await client.subscriptionSchedules.release(id); },
    update: async (params, idempotencyKey) => { await client.subscriptions.update(sub.id, params, { idempotencyKey }); },
    schedule: async config => {
      await writeSchedule(sub.id, config, false);
      if (loseScheduleResponse) { loseScheduleResponse = false; throw new Error("Lost schedule response"); }
    },
    cancelAtEnd: async cancel => {
      const fresh = await client.subscriptions.retrieve(sub.id);
      if (fresh.schedule) {
        const id = typeof fresh.schedule === "string" ? fresh.schedule : fresh.schedule.id;
        await client.subscriptionSchedules.update(id, { end_behavior: cancel ? "cancel" : "release" });
      } else if (fresh.cancel_at_period_end !== cancel) await client.subscriptions.update(sub.id, { cancel_at_period_end: cancel });
    },
    now: () => now,
  };
  await assert.rejects(() => runPlanTransition(durable, ports), (error: unknown) =>
    Boolean(error && typeof error === "object" && "type" in error && error.type === "StripeCardError"));
  assert.equal(durable.phase, "aborted");
  const declined = await client.subscriptions.retrieve(sub.id, { expand: ["schedule"] });
  assert.equal(declined.pending_update, null);
  assert.equal(declined.items.data[0].price.lookup_key, "core_starter_month_v1");
  const schedule = declined.schedule as Stripe.SubscriptionSchedule;
  const next = schedule.phases[1].items[0].price;
  const nextPrice = await client.prices.retrieve(typeof next === "string" ? next : next.id);
  assert.equal(nextPrice.lookup_key, "core_starter_year_v1");
  console.log("ok: declined upgrade preserves Starter and restores its previous annual renewal");
  await client.subscriptionSchedules.release(schedule.id);
  durable = { ...durable, id: randomUUID(), phase: "prepared", previous: null,
    update: { ...durable.update, payment_behavior: "pending_if_incomplete" } };
  await runPlanTransition(durable, ports);
  assert.equal(durable.phase, "waiting");
  const pending = await client.subscriptions.retrieve(sub.id, { expand: ["latest_invoice"] });
  assert.ok(pending.pending_update);
  assert.equal(pending.schedule, null);
  await client.subscriptions.update(sub.id, { default_payment_method: good.id });
  const invoice = pending.latest_invoice as Stripe.Invoice;
  await client.invoices.pay(invoice.id, { payment_method: good.id });
  loseScheduleResponse = true;
  await assert.rejects(() => runPlanTransition(durable, ports), /Lost schedule response/);
  await runPlanTransition(durable, ports);
  assert.equal(durable.phase, "complete");
  const paid = await client.subscriptions.retrieve(sub.id, { expand: ["schedule"] });
  assert.equal(paid.items.data[0].price.lookup_key, "core_pro_month_v1");
  const target = (paid.schedule as Stripe.SubscriptionSchedule).phases[1].items[0].price;
  assert.equal((await client.prices.retrieve(typeof target === "string" ? target : target.id)).lookup_key, "core_pro_year_v1");
  const invoices = await client.invoices.list({ subscription: sub.id, limit: 100 });
  assert.equal(invoices.data.filter(row => row.billing_reason === "subscription_update" && row.status === "paid").length, 1);
  await runPlanTransition(durable, ports);
  console.log("ok: delayed payment grants Pro once and installs the requested annual renewal; completed replay is inert");
} finally {
  if (clockId) await client.testHelpers.testClocks.del(clockId);
  await globalThis.__fsmDbPool?.end({ timeout: 2 });
  await globalThis.__fsmOperationLocks?.end({ timeout: 2 });
}
