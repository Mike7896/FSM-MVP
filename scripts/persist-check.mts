/**
 * The Scope tree, persisted — checked against a real database.
 *
 * `scripts/tree-check.ts` pins the arithmetic in memory. This pins the part
 * that talks to Postgres, which is where the tree is most easily lost:
 *
 * - **The SQL implementations agree with `totals()`.** The quotes list, the job
 *   hub, the materials budget and the dashboard derive the same number from the
 *   same `scope_nodes`, and a quote that shows one total in the list and another
 *   in the editor is the single most trust-destroying bug this product can ship.
 * - **`parent_node_id` cascades on delete**, so "break this bundle apart" — which
 *   keeps the children and drops the parent — would take the children with it
 *   unless the tree is detached before the delete. That step is easy to lose in
 *   a refactor and silent when it goes.
 * - **Node ids survive a save.** An option names Scope nodes by id and a
 *   permit's fee points at one, so replacing the tree wholesale on every write
 *   would empty every tier on a tiered quote.
 *
 * It writes a throwaway customer, job and quote and deletes them in a `finally`.
 *
 *     npm run quote:persist-check
 */

// `lib/db` and the query modules guard themselves with `server-only`, which
// throws unless the resolver picks the react-server condition. This script *is*
// server code — same database, same helpers — so it is run with
// `--conditions=react-server`, exactly what Next resolves with.

import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { customers } from "@/lib/db/schema/office";
import { jobs } from "@/lib/db/schema/jobs";
import { documents, quoteDetails } from "@/lib/db/schema/document-spine";
import { writeScopeTree } from "@/lib/documents/scope-write";
import { getQuote, listQuotes } from "@/lib/queries/quotes";
import { jobMoney, materialsBudget } from "@/lib/queries/jobs";
import { getDashboard } from "@/lib/queries/dashboard";
import { formatMoney } from "@/lib/quote/money";
import { draftFromRecord, emptyDraft, makeNode, toSavePayload } from "@/lib/quote/draft";
import {
  dissolveNode, findNode, flatten, insertNode, removeNode, replaceNode,
} from "@/lib/quote/tree";
import { totals } from "@/lib/quote/totals";
import type { QuoteDraft } from "@/lib/quote/types";

let bad = 0;
const is = (label: string, a: unknown, b: unknown) => {
  const ok = JSON.stringify(a) === JSON.stringify(b);
  if (!ok) bad++;
  console.log(`${ok ? "  ok  " : "FAIL  "} ${label}${ok ? "" : `\n        got ${JSON.stringify(a)}\n        want ${JSON.stringify(b)}`}`);
};

const [org] = await db.select({ id: jobs.organizationId }).from(jobs).limit(1);
if (!org) throw new Error("no organization to test against");

/**
 * Saves exactly the way `PATCH /api/v1/quotes/[id]` does — by calling the same
 * function, not by copying it. That is the point: the ordering inside
 * `writeScopeTree` is what these checks are for.
 */
async function save(quoteId: string, draft: QuoteDraft) {
  await db.transaction((tx) =>
    writeScopeTree(
      tx,
      { documentId: quoteId, organizationId: org.id },
      toSavePayload(draft).scope
    )
  );
  const record = await getQuote(quoteId, org.id);
  return draftFromRecord(record!);
}

const shape = (d: QuoteDraft) =>
  flatten(d.scope).map((f) => `${"  ".repeat(depthOf(d, f.node.key))}${f.node.type}:${f.node.description}`);
function depthOf(d: QuoteDraft, key: string) {
  let out = 0;
  const step = (ns: typeof d.scope, depth: number) => {
    for (const n of ns) { if (n.key === key) out = depth; step(n.children, depth + 1); }
  };
  step(d.scope, 0);
  return out;
}

const [customer] = await db.insert(customers)
  .values({ organizationId: org.id, name: "Scope Tree Check" }).returning();
const [job] = await db.insert(jobs)
  .values({ organizationId: org.id, customerId: customer.id, name: "scope tree check" }).returning();
const [quote] = await db.insert(documents)
  .values({
    organizationId: org.id,
    jobId: job.id,
    customerId: customer.id,
    type: "quote",
    number: "",
    status: "draft",
    title: "scope tree check",
  })
  .returning();
await db.insert(quoteDetails).values({ documentId: quote.id, taxRate: "0.0625" });

try {
  /* 1 — a full tree survives the round trip. Built by hand: a typed sentence
     no longer drafts rows, and this check needs every shape the SQL has to
     agree about — a group, an assembly inside it, a permit at the root, text. */
  const seeded: QuoteDraft = {
    ...emptyDraft({
      customerName: "Scope Tree Check",
      title: "200A panel upgrade + two 20A kitchen circuits",
      scope: [
        makeNode("group", { description: "Service upgrade", children: [
          makeNode("assembly", { description: "200A panel and breakers", quantity: 1, children: [
            makeNode("item", { section: "material", description: "200A main panel", quantity: 1, unit: "ea", sellPriceCents: 65_000 }),
            makeNode("item", { section: "material", description: "Breakers and fill", quantity: 1, unit: "ea", sellPriceCents: 30_000 }),
            makeNode("item", { section: "labor", description: "Set the panel and land the circuits", quantity: 3, unit: "hr", sellPriceCents: 9_500 }),
          ] }),
          makeNode("item", { section: "material", description: "Meter base, mast and service cable", quantity: 1, unit: "ea", sellPriceCents: 45_000 }),
          makeNode("item", { section: "labor", description: "Service change-out", quantity: 6, unit: "hr", sellPriceCents: 9_500 }),
        ] }),
        makeNode("group", { description: "Kitchen circuits", children: [
          makeNode("item", { section: "material", description: "20A circuit — wire, breaker and receptacle", quantity: 2, unit: "ea", sellPriceCents: 15_000 }),
          makeNode("item", { section: "labor", description: "Run and terminate at the panel", quantity: 6, unit: "hr", sellPriceCents: 9_500 }),
        ] }),
        makeNode("item", { section: "permit", description: "Permit — pulled and inspected", quantity: 1, unit: "ea", sellPriceCents: 18_500 }),
        makeNode("exclusion", { description: "Drywall patching and paint after the work" }),
        makeNode("assumption", { description: "The existing service entrance is accessible from outside" }),
      ],
    }),
    taxRate: 0.0625,
  };
  const back = await save(quote.id, seeded);
  is("shape survives the round trip", shape(back), shape(seeded));
  is("totals survive the round trip", totals(back).totalCents, totals(seeded).totalCents);
  is("a container stores no price", flatten(back.scope).filter(f => f.node.type === "group").every(f => f.node.sellPriceCents === 0), true);
  is("a container carries no bucket", flatten(back.scope).filter(f => f.node.type !== "item").every(f => f.node.section === null), true);

  /* 2 — the list SQL agrees with totals() */
  const [listed] = await listQuotes(org.id, { jobId: job.id, limit: 1, offset: 0 });
  is("list SQL agrees with totals()", listed.totalCents, totals(back).totalCents);

  /* 2b — the job hub is a third implementation of the same arithmetic, and the
     materials budget a fourth reader of the same rows. Checked here, while the
     tree is still whole, because every step below deliberately damages it. */
  const money = await jobMoney([job.id]);
  is("job hub SQL agrees with totals()", money.get(job.id)?.totalCents, totals(back).totalCents);
  is("materials budget agrees with the material bucket",
    await materialsBudget(job.id), totals(back).bySection.material);

  /* 3 — optional is inherited by the SQL too */
  const group = back.scope.find((n) => n.description === "Kitchen circuits")!;
  const withOptional = { ...back, scope: replaceNode(back.scope, group.key, (n) => ({ ...n, optional: true })) };
  const afterOptional = await save(quote.id, withOptional);
  const [listed2] = await listQuotes(org.id, { jobId: job.id, limit: 1, offset: 0 });
  is("optional group leaves the total", totals(afterOptional).totalCents < totals(back).totalCents, true);
  is("list SQL inherits optional", listed2.totalCents, totals(afterOptional).totalCents);

  /* 4 — ids are stable across a save, so an option's references would survive */
  const idsBefore = flatten(afterOptional.scope).map((f) => f.node.id).sort();
  const resaved = await save(quote.id, afterOptional);
  is("node ids are stable across a save", flatten(resaved.scope).map((f) => f.node.id).sort(), idsBefore);

  /* 5 — break apart keeps the children even though parent_node_id cascades */
  const assembly = flatten(resaved.scope).find((f) => f.node.type === "assembly")!.node;
  const childCount = assembly.children.length;
  const before = flatten(resaved.scope).length;
  const broken = await save(quote.id, { ...resaved, scope: dissolveNode(resaved.scope, assembly.key) });
  is("break apart keeps every child", flatten(broken.scope).length, before - 1);
  is("...and they are no longer nested", flatten(broken.scope).filter(f => f.node.type === "assembly").length, 0);
  console.log(`        (${childCount} children survived the parent being deleted)`);

  /* 6 — deleting a group really does take its rows with it */
  const survivor = broken.scope.find((n) => n.type === "group")!;
  const inside = flatten([survivor]).length;
  const pruned = await save(quote.id, { ...broken, scope: removeNode(broken.scope, survivor.key) });
  is("deleting a group removes its rows", flatten(pruned.scope).length, flatten(broken.scope).length - inside);

  /* 7 — the dashboard is a fifth reader of the same arithmetic */
  {
    // Rebuild a tree with an optional row in it, and put the quote in front of
    // the customer so the dashboard picks it up.
    const optionalFirst = await save(quote.id, {
      ...seeded,
      scope: replaceNode(seeded.scope, seeded.scope[0].key, (n) => ({
        ...n,
        optional: true,
      })),
    });

    await db
      .update(documents)
      .set({ status: "sent", sentAt: new Date() })
      .where(eq(documents.id, quote.id));

    const dashboard = await getDashboard(org.id);
    const expected = formatMoney(totals(optionalFirst).totalCents);

    const row = dashboard.waitingOnCustomer.find((entry) =>
      entry.href.includes(quote.id)
    );

    // The bug this pins: the dashboard used to sum every row, so an optional row
    // inflated the total here while the editor and the shelf held it out — the
    // same quote, two different numbers, one click apart.
    is(
      "dashboard agrees with totals() on an optional row",
      row ? row.sentence.includes(expected) || row.detail.includes(expected) : "row missing",
      true
    );

    await db
      .update(documents)
      .set({ status: "draft", sentAt: null })
      .where(eq(documents.id, quote.id));
  }

  /* 8 — reparenting: move a root row into the remaining group */
  const target = pruned.scope.find((n) => n.type === "group");
  const mover = pruned.scope.find((n) => n.type === "item" && n.section === "permit");
  if (target && mover) {
    const moved = await save(quote.id, {
      ...pruned,
      scope: insertNode(removeNode(pruned.scope, mover.key), mover, target.key, null),
    });
    const nowInside = findNode(moved.scope, moved.scope.find(n => n.type === "group")!.key)!
      .children.some((c) => c.section === "permit");
    is("a row reparents without being lost", nowInside, true);
    is("nothing else went missing", flatten(moved.scope).length, flatten(pruned.scope).length);
  } else {
    console.log("  --   reparent skipped (no group left after step 6)");
  }
} finally {
  // The quote, its details and its Scope go with the job.
  await db.delete(jobs).where(eq(jobs.id, job.id));
  await db.delete(customers).where(eq(customers.id, customer.id));
}

console.log(bad === 0 ? "\nPersistence checks passed." : `\n${bad} FAILED`);
process.exit(bad === 0 ? 0 : 1);
