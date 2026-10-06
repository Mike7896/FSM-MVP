/** Database-backed collection regression tests. Stripe transport is stubbed;
 * no real or sandbox charge is created. Only the named disposable shop is removed. */
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { randomUUID } from "node:crypto";
import type Stripe from "stripe";
import { eq, sql } from "drizzle-orm";
const require = createRequire(import.meta.url);
// Fail closed if a future test path escapes the stubbed SDK methods.
process.env.STRIPE_SECRET_KEY = "sk_test_collection_transport_stub";
const { db } = require("@/lib/db") as typeof import("@/lib/db");
const { withOperationLock } = require("@/lib/db/operation-lock") as typeof import("@/lib/db/operation-lock");
const { paymentAttempts } = require("@/lib/db/schema/membership") as typeof import("@/lib/db/schema/membership");
const { ensureShareLink } = require("@/lib/documents/share-links") as typeof import("@/lib/documents/share-links");
const { getActivationUsage } = require("@/lib/membership/activation") as typeof import("@/lib/membership/activation");
const { startPaymentAttempt, onPaymentIntentEvent, onAttemptRefunded } = require("@/lib/stripe/collect") as typeof import("@/lib/stripe/collect");
const { stripe } = require("@/lib/stripe/server") as typeof import("@/lib/stripe/server");


const client = stripe();
const intents = new Map<string, Stripe.PaymentIntent>();
const keys = new Map<string, Stripe.PaymentIntent>();
let created = 0;
let loseResponse = false;
client.accounts.retrieve = (async () => ({ capabilities: { card_payments: "active", us_bank_account_ach_payments: "active" } })) as unknown as typeof client.accounts.retrieve;
client.paymentIntents.retrieve = (async (id: string) => {
  assert.ok(intents.has(id));
  return intents.get(id)!;
}) as typeof client.paymentIntents.retrieve;
client.paymentIntents.cancel = (async (id: string) => {
  const intent = intents.get(id)!;
  assert.notEqual(intent.status, "processing");
  assert.notEqual(intent.status, "succeeded");
  intent.status = "canceled";
  return intent;
}) as typeof client.paymentIntents.cancel;
client.paymentIntents.create = (async (params: Stripe.PaymentIntentCreateParams, options: Stripe.RequestOptions) => {
  const key = options.idempotencyKey!;
  if (keys.has(key)) return keys.get(key)!;
  const intent = { id: `pi_check_${++created}`, status: "requires_payment_method", client_secret: "test_secret", metadata: params.metadata, amount: params.amount } as Stripe.PaymentIntent;
  intents.set(intent.id, intent);
  keys.set(key, intent);
  if (loseResponse) { loseResponse = false; throw new Error("Simulated lost Stripe response"); }
  return intent;
}) as typeof client.paymentIntents.create;

async function cleanup(id: string) {
  await db.transaction(async (tx) => {
    const [org] = await tx.execute<{ slug: string }>(sql`select slug from organizations where id = ${id}`);
    assert.ok(org?.slug.startsWith("collection-check-"));
    await tx.execute(sql`set local session_replication_role = replica`);
    await tx.execute(sql`delete from share_links where document_id in (select id from documents where organization_id = ${id})`);
    await tx.execute(sql`delete from invoice_details where document_id in (select id from documents where organization_id = ${id})`);
    await tx.execute(sql`delete from ledger_entries where organization_id = ${id}`);
    await tx.execute(sql`delete from payment_attempts where organization_id = ${id}`);
    await tx.execute(sql`delete from documents where organization_id = ${id}`);
    await tx.execute(sql`set local session_replication_role = origin`);
    await tx.execute(sql`delete from organizations where id = ${id}`);
  });
}
// Recover only this suite's disposable rows if a previous run was interrupted.
const leftovers = await db.execute<{ id: string }>(sql`select id from organizations where slug like 'collection-check-%'`);
for (const row of leftovers) await cleanup(row.id);
let organizationId: string | undefined;
let passed = 0;
function check(label: string, condition = true) { assert.ok(condition, label); console.log(`ok ${++passed}: ${label}`); }
try {
  const [org] = await db.execute<{ id: string }>(sql`insert into organizations (name, slug) values ('Collection regression', ${`collection-check-${randomUUID()}`}) returning id`);
  organizationId = org.id;
  const accountId = `acct_check_${randomUUID()}`;
  await db.execute(sql`insert into connected_accounts (organization_id, stripe_account_id, charges_enabled) values (${org.id}, ${accountId}, true)`);
  await db.execute(sql`insert into connections (organization_id, provider, kind, status, external_account_id) values (${org.id}, 'stripe_connect', 'processor', 'connected', ${accountId})`);
  const [customer] = await db.execute<{ id: string }>(sql`insert into customers (organization_id, name) values (${org.id}, 'Test customer') returning id`);
  async function invoice() {
    const [job] = await db.execute<{ id: string }>(sql`insert into jobs (organization_id, customer_id, name) values (${org.id}, ${customer.id}, 'Test job') returning id`);
    const [doc] = await db.execute<{ id: string }>(sql`insert into documents (organization_id, job_id, customer_id, type, status) values (${org.id}, ${job.id}, ${customer.id}, 'invoice', 'draft') returning id`);
    await db.execute(sql`insert into invoice_details (document_id, invoice_type, amount_due_cents) values (${doc.id}, 'deposit', 10000)`);
    await db.execute(sql`update documents set status = 'sent' where id = ${doc.id}`);
    return { ...await ensureShareLink({ id: doc.id, jobId: job.id }, ["view", "pay"]), id: doc.id };
  }
  const bill = await invoice();
  const first = await startPaymentAttempt(bill.token, "card");
  const reopened = await startPaymentAttempt(bill.token, "card");
  check("reopening the same payment form reuses its intent", first?.attempt.paymentIntentId === reopened?.attempt.paymentIntentId && created === 1);
  const bank = await startPaymentAttempt(bill.token, "ach");
  check("switching rails cancels the old payable intent", intents.get(first!.attempt.paymentIntentId!)!.status === "canceled" && created === 2);
  const remote = intents.get(bank!.attempt.paymentIntentId!)!;
  remote.status = "processing";
  await assert.rejects(() => startPaymentAttempt(bill.token, "card"), /already being confirmed/);
  check("a delayed processing webhook cannot permit a second charge", created === 2);
  await onPaymentIntentEvent({ ...remote, status: "requires_payment_method", last_payment_error: { type: "card_error", message: "Old failure" } }, { organizationId: org.id, stripeAccountId: accountId });
  const [projected] = await db.select().from(paymentAttempts).where(eq(paymentAttempts.id, bank!.attempt.id));
  check("an old failure event reads fresh Stripe state", projected.status === "processing");
  remote.status = "succeeded";
  await onPaymentIntentEvent(remote, { organizationId: org.id, stripeAccountId: accountId });
  await assert.rejects(() => startPaymentAttempt(bill.token, "card"), /already being confirmed/);
  check("a succeeded intent still blocks collection while its ledger event is delayed");
  await db.update(paymentAttempts).set({ applicationFeeCents: 20 }).where(eq(paymentAttempts.id, bank!.attempt.id));
  const charge = { id: "ch_collection_check", payment_intent: remote.id, amount: 10000, amount_refunded: 5000, application_fee: "fee_collection_check", currency: "usd" } as Stripe.Charge;
  const feeRefunds: Stripe.FeeRefund[] = [];
  client.charges.retrieve = (async () => charge) as unknown as typeof client.charges.retrieve;
  client.applicationFees.retrieve = (async () => ({ amount: 20, amount_refunded: feeRefunds.reduce((sum, row) => sum + row.amount, 0) })) as unknown as typeof client.applicationFees.retrieve;
  client.applicationFees.createRefund = (async (_id: string, params: Stripe.ApplicationFeeCreateRefundParams) => {
    const refund = { id: `fr_check_${feeRefunds.length}`, amount: params.amount!, created: Math.floor(Date.now()/1000) } as Stripe.FeeRefund;
    feeRefunds.push(refund);
    return refund;
  }) as typeof client.applicationFees.createRefund;
  client.applicationFees.listRefunds = (() => ({ async *[Symbol.asyncIterator]() { yield* feeRefunds; } })) as unknown as typeof client.applicationFees.listRefunds;
  const context = { organizationId: org.id, stripeAccountId: accountId };
  await onAttemptRefunded(charge, context);
  await onAttemptRefunded({ ...charge, amount_refunded: 1 }, context);
  check("partial fee refunds use fresh cumulative principal and deduplicate events", feeRefunds.length === 1 && feeRefunds[0].amount === 10);
  charge.amount_refunded = 10000;
  await onAttemptRefunded(charge, context);
  check("the final refund returns precisely the remaining fee", feeRefunds.reduce((sum, row) => sum + row.amount, 0) === 20);
  await db.transaction(async (tx) => {
    await tx.execute(sql`set local session_replication_role = replica`);
    await tx.execute(sql`delete from ledger_entries where organization_id = ${org.id}`);
  });
  await onAttemptRefunded(charge, context);
  const [feeLedger] = await db.execute<{ total: string }>(sql`select sum(amount_cents)::text as total from ledger_entries where organization_id = ${org.id}`);
  check("replaying a completed fee refund repairs a missing local ledger write", Number(feeLedger.total) === 20 && feeRefunds.length === 2);
  const retryBill = await invoice();
  loseResponse = true;
  await assert.rejects(() => startPaymentAttempt(retryBill.token, "card"), /lost Stripe response/);
  const beforeRetry = created;
  await startPaymentAttempt(retryBill.token, "card");
  check("a lost response recovers the persisted idempotency key", created === beforeRetry);
  check("online collection activates its job once", (await getActivationUsage(org.id)).used === 2);

  let unlock!: () => void;
  let entered!: () => void;
  const hold = new Promise<void>((resolve) => { unlock = resolve; });
  const ready = new Promise<void>((resolve) => { entered = resolve; });
  const firstLock = withOperationLock(org.id, 99, async () => { entered(); await hold; });
  await ready;
  try { await assert.rejects(() => withOperationLock(org.id, 99, async () => undefined), /in progress/); }
  finally { unlock(); await firstLock; }
  check("concurrent writes to one operation refuse instead of overlapping");
  await Promise.all(Array.from({ length: 12 }, (_, i) => withOperationLock(`${org.id}:${i}`, 99, async () => {
    await db.execute(sql`select 1`);
    await withOperationLock(`${org.id}:nested:${i}`, 99, async () => db.execute(sql`select 1`));
  })));
  check("more concurrent operations than data connections, including nested locks, do not starve the pool");
} catch (error) {
  console.error(error instanceof Error ? error.message : "Collection test failed");
  process.exitCode = 1;
} finally {
  if (organizationId) await cleanup(organizationId);
  await globalThis.__fsmDbPool?.end({ timeout: 5 });
  await globalThis.__fsmOperationLocks?.end({ timeout: 5 });
}
console.log(`${passed} collection checks passed.`);
