/** Disposable, uniquely named fixtures only. No Stripe calls, emails, or release changes. */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import { eq, sql } from "drizzle-orm";
const require = createRequire(import.meta.url);
process.env.STRIPE_SECRET_KEY = "sk_test_no_transport_launch_checks";
const { db } = require("@/lib/db") as typeof import("@/lib/db");
const { billingAccounts, jobActivations, savedItems } = require("@/lib/db/schema") as typeof import("@/lib/db/schema");
const { requireSavedItems } = require("@/lib/membership/features") as typeof import("@/lib/membership/features");
const { listSavedItems } = require("@/lib/queries/library") as typeof import("@/lib/queries/library");
const { listQuotes, getQuote } = require("@/lib/queries/quotes") as typeof import("@/lib/queries/quotes");
const { exportRows } = require("@/lib/export/tables") as typeof import("@/lib/export/tables");
const { withDocumentActivation, withActivation, getActivationUsage, reserveActivation, commitActivation, releaseActivation } = require("@/lib/membership/activation") as typeof import("@/lib/membership/activation");
const { ensureShareLink } = require("@/lib/documents/share-links") as typeof import("@/lib/documents/share-links");
let orgId: string | undefined;
const slug = `launch-check-${randomUUID()}`;
let passed = 0;
function check(label: string) { console.log(`ok ${++passed}: ${label}`); }
try {
  const [org] = await db.execute<{ id: string }>(sql`insert into organizations (name, slug) values ('Launch regression', ${slug}) returning id`);
  orgId = org.id;
  const [customer] = await db.execute<{ id: string }>(sql`insert into customers (organization_id, name) values (${org.id}, 'Fixture customer') returning id`);
  async function document() {
    const [job] = await db.execute<{ id: string }>(sql`insert into jobs (organization_id, customer_id, name) values (${org.id}, ${customer.id}, 'Fixture job') returning id`);
    const [doc] = await db.execute<{ id: string }>(sql`insert into documents (organization_id, job_id, customer_id, type, status) values (${org.id}, ${job.id}, ${customer.id}, 'quote', 'draft') returning id`);
    return { id: doc.id, jobId: job.id };
  }
  await assert.rejects(() => requireSavedItems(org.id), /require Starter or Pro/);
  const [item] = await db.insert(savedItems).values({ organizationId: org.id, name: "Fixture item",
    template: { type: "item", description: "Fixture item", section: null, quantity: 1, unit: null,
      unitCostCents: null, markupPercent: null, sellPriceCents: 1000, taxable: false, optional: false, children: [] },
    settings: [], defaults: {}, source: "shop" }).returning();
  assert.deepEqual(await listSavedItems(org.id), []);
  assert.equal((await exportRows(org.id, "saved-items")).rows[0].Id, item.id);
  check("Free cannot use paid library; retained entries still export");

  await db.insert(billingAccounts).values({ organizationId: org.id, subscriptionId: `sub_fixture_${randomUUID()}`, subscriptionStatus: "active", tier: "starter", interval: "month", paidThrough: new Date(Date.now() + 86400000) });
  await requireSavedItems(org.id);
  assert.equal((await listSavedItems(org.id)).length, 1);
  check("Starter can access saved items");
  const viewed = await document();
  await db.execute(sql`update documents set status = 'viewed', sent_at = now(), viewed_at = now() where id = ${viewed.id}`);
  const options = { limit: 100, offset: 0 };
  const starterList = await listQuotes(org.id, options);
  assert.equal(starterList[0].viewedAt, null);
  assert.equal(starterList[0].status, "sent");
  assert.equal((await getQuote(viewed.id, org.id))?.status, "sent");
  assert.equal((await listQuotes(org.id, { ...options, status: "viewed" })).length, 0);
  assert.equal((await listQuotes(org.id, { ...options, status: "sent" })).length, 1);
  check("Starter list, detail, and status filters do not disclose views");
  await db.update(billingAccounts).set({ tier: "pro" }).where(eq(billingAccounts.organizationId, org.id));
  assert.ok((await listQuotes(org.id, options))[0].viewedAt);
  assert.equal((await getQuote(viewed.id, org.id))?.status, "viewed");
  check("Pro sees historical tracking");
  await db.update(billingAccounts).set({ subscriptionStatus: "past_due", pastDueSince: new Date(Date.now() - 8 * 86400000) }).where(eq(billingAccounts.organizationId, org.id));
  await assert.rejects(() => requireSavedItems(org.id), /require Starter or Pro/);
  assert.equal((await listQuotes(org.id, options))[0].viewedAt, null);
  assert.equal((await db.select().from(savedItems).where(eq(savedItems.id, item.id))).length, 1);
  check("restricted accounts lose paid access without deleting stored work");

  const published = await document();
  await assert.rejects(() => withDocumentActivation({ organizationId: org.id, documentId: published.id, action: "quote_sent" }, async () => {
    await ensureShareLink(published, ["view", "accept"]);
    throw new Error("Email succeeded; later record failed");
  }), /later record failed/);
  assert.equal((await getActivationUsage(org.id)).used, 1);
  check("failure after publication cannot release an activation");
  await withDocumentActivation({ organizationId: org.id, documentId: published.id, action: "quote_sent" }, () => ensureShareLink(published, ["view", "accept"]));
  assert.equal((await getActivationUsage(org.id)).used, 1);
  check("retrying a published document costs no additional activation");
  const rolledBack = await document();
  await assert.rejects(() => withDocumentActivation({ organizationId: org.id, documentId: rolledBack.id, action: "quote_sent" }, () => db.transaction(async tx => {
    await ensureShareLink(rolledBack, ["view"], tx);
    throw new Error("Publication transaction rolled back");
  })), /rolled back/);
  assert.equal((await getActivationUsage(org.id)).used, 1);
  const links = await db.execute(sql`select id from share_links where document_id = ${rolledBack.id}`);
  assert.equal(links.length, 0);
  check("rolled-back publication retains neither link nor activation");

  const preflight = await document();
  await assert.rejects(() => withActivation({ organizationId: org.id, jobId: preflight.jobId, action: "quote_sent" }, async () => { throw new Error("Validation failed"); }), /Validation failed/);
  assert.equal((await getActivationUsage(org.id)).used, 1);
  check("failure before publication releases the reservation");
  const stale = await reserveActivation({ organizationId: org.id, jobId: preflight.jobId, action: "pdf" });
  await db.update(jobActivations).set({ token: randomUUID() }).where(eq(jobActivations.jobId, preflight.jobId));
  await assert.rejects(() => commitActivation(stale), /reservation expired/);
  await db.delete(jobActivations).where(eq(jobActivations.jobId, preflight.jobId));
  check("an old worker cannot commit a replacement worker's reservation");

  const second = await document();
  await withActivation({ organizationId: org.id, jobId: second.jobId, action: "pdf" }, async () => {});
  const third = await document();
  const fourth = await document();
  const raced = await Promise.allSettled([third, fourth].map(doc => reserveActivation({ organizationId: org.id, jobId: doc.jobId, action: "pdf" })));
  assert.equal(raced.filter(r => r.status === "fulfilled").length, 1);
  for (const row of raced) if (row.status === "fulfilled") await releaseActivation(row.value);
  check("concurrent last-slot reservations still enforce the Free limit");
  console.log(`${passed} database checks passed`);
} finally {
  if (orgId) await db.transaction(async tx => {
    const [row] = await tx.execute<{ slug: string }>(sql`select slug from organizations where id = ${orgId}`);
    assert.equal(row?.slug, slug);
    // Only this run's known fixture rows. Some document/audit tables are
    // append-only, so cleanup uses the same scoped approach as existing suites.
    await tx.execute(sql`set local session_replication_role = replica`);
    await tx.execute(sql`delete from share_links where document_id in (select id from documents where organization_id = ${orgId})`);
    await tx.execute(sql`delete from documents where organization_id = ${orgId}`);
    await tx.execute(sql`delete from job_activations where organization_id = ${orgId}`);
    await tx.execute(sql`delete from saved_items where organization_id = ${orgId}`);
    await tx.execute(sql`delete from billing_accounts where organization_id = ${orgId}`);
    await tx.execute(sql`delete from jobs where organization_id = ${orgId}`);
    await tx.execute(sql`delete from customers where organization_id = ${orgId}`);
    await tx.execute(sql`delete from organizations where id = ${orgId}`);
  });
  await globalThis.__fsmDbPool?.end({ timeout: 2 });
}
