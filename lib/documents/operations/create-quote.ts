import "server-only";

import { and, eq, ilike } from "drizzle-orm";

import { db } from "@/lib/db";
import {
  customers,
  documents,
  jobs,
  officeDefaults,
  quoteDetails,
  scopeNodes,
} from "@/lib/db/schema";
import type { QuoteRecord } from "@/lib/quote";
import type { CreateQuoteInput } from "@/lib/schemas";

import { DocumentError } from "../errors";
import { readQuoteRecord } from "../quote-record";
import { resolveScopeNodes } from "../scope-write";

/**
 * `createQuote` — a priced document, from nothing.
 *
 * **Creating a quote creates whatever it needs underneath it**: a Customer from a
 * bare typed name, and a Job to hang the document off. That is the model working
 * as designed rather than a convenience — the Job is the only prerequisite
 * anywhere, made silently by whichever document comes first, which is what lets
 * a contractor start a quote from nothing at a kitchen table.
 *
 * **A demo quote gets its own Job and its own Customer, always.** It is never
 * matched to a real customer by name and never added to a real job: the demo
 * flag lives on the Job and everything counted leaves demo Jobs out, so a
 * practice quote hung off real work would either leak into the numbers or drag
 * the real job out of them.
 */
export async function createQuote({
  organizationId,
  userId,
  input,
}: {
  organizationId: string;
  userId: string;
  input: CreateQuoteInput;
}): Promise<QuoteRecord> {
  const demo = input.demo === true;

  return db.transaction(async (tx) => {
    /* ── The customer ─────────────────────────────────────────────────── */

    let customerId = demo ? null : (input.customerId ?? null);

    if (customerId) {
      // Checked against this shop before a job is hung off it. Drizzle bypasses
      // RLS; this is what stops a quote being written against someone else's
      // customer.
      const [existing] = await tx
        .select({ id: customers.id })
        .from(customers)
        .where(
          and(
            eq(customers.id, customerId),
            eq(customers.organizationId, organizationId)
          )
        )
        .limit(1);
      if (!existing) customerId = null;
    }

    const typedName = input.customerName?.trim();

    if (!customerId && typedName && !demo) {
      // The same person quoted twice should not become two rows in his
      // directory, and the name is all he typed. Demo customers never match —
      // real work does not land on practice.
      const [match] = await tx
        .select({ id: customers.id })
        .from(customers)
        .where(
          and(
            eq(customers.organizationId, organizationId),
            eq(customers.isDemo, false),
            ilike(customers.name, typedName)
          )
        )
        .limit(1);

      customerId = match?.id ?? null;
    }

    if (!customerId) {
      // The Job's customer is NOT NULL, so a row is made here — named if a
      // name was typed, and a placeholder otherwise, which the flow allows
      // before he has said who it's for.
      const [row] = await tx
        .insert(customers)
        .values({
          organizationId,
          name: typedName || "New customer",
          address: input.address,
          isDemo: demo,
        })
        .returning({ id: customers.id });
      customerId = row.id;
    }

    /* ── The job ──────────────────────────────────────────────────────── */

    let jobId = input.jobId ?? null;

    if (jobId) {
      // An existing job only when its demo flag matches this quote's.
      const [existing] = await tx
        .select({ id: jobs.id })
        .from(jobs)
        .where(
          and(
            eq(jobs.id, jobId),
            eq(jobs.organizationId, organizationId),
            eq(jobs.isDemo, demo)
          )
        )
        .limit(1);
      if (!existing) jobId = null;
    }

    if (!jobId) {
      const [job] = await tx
        .insert(jobs)
        .values({
          organizationId,
          customerId,
          name: input.title,
          address: input.address,
          packId: input.packId,
          isDemo: demo,
          createdBy: userId,
          // `number` and `jurisdiction` are assigned by trigger.
        })
        .returning({ id: jobs.id });
      jobId = job.id;
    }

    /* ── The document ─────────────────────────────────────────────────── */

    const terms = input.terms ?? {};

    // The shop's draw pattern, copied onto the quote rather than read live:
    // changing a default must never move the payment schedule on a quote
    // somebody is already holding.
    const [defaults] = await tx
      .select({ drawPattern: officeDefaults.drawPattern })
      .from(officeDefaults)
      .where(eq(officeDefaults.organizationId, organizationId))
      .limit(1);

    const [document] = await tx
      .insert(documents)
      .values({
        organizationId,
        jobId,
        customerId,
        type: "quote",
        // Assigned by `set_document_number` — per shop and per type.
        number: "",
        status: "draft",
        title: input.title,
        summary: input.summary,
        packId: input.packId,
        createdBy: userId,
      })
      .returning({ id: documents.id });

    await tx.insert(quoteDetails).values({
      documentId: document.id,
      // `numeric` takes a string; a float is how a rate ends up stored as
      // 0.08250000000000001.
      taxRate: input.taxRate == null ? null : String(input.taxRate),
      contractType: terms.contractType ?? null,
      priceStructure: terms.priceStructure ?? null,
      scopeDetail: terms.scopeDetail ?? null,
      pricingMethod: terms.pricingMethod ?? null,
      estimatingMethod: terms.estimatingMethod ?? null,
      estimateClass: terms.estimateClass ?? null,
      billingTrigger: terms.billingTrigger ?? null,
      moneyUpFront: terms.moneyUpFront ?? null,
      depositPercent: terms.depositPercent ?? null,
      progressBilling: terms.progressBilling ?? null,
      retainagePercent: terms.retainagePercent ?? null,
      capCents: terms.capCents ?? null,
      // The editor starts a quote with the shop's pattern already in its
      // phases; a client that sends none gets the pattern copied here.
      drawPattern:
        terms.phases !== undefined
          ? terms.phases.length
            ? terms.phases
            : null
          : (defaults?.drawPattern ?? null),
      phaseSplit: terms.phaseSplit ?? null,
      signatureLines: input.signatureLines ?? true,
    });

    /* ── The Scope tree ───────────────────────────────────────────────── */

    // Nothing exists yet, so every node is new. The whole tree goes in one
    // statement: referential integrity is checked at the end of it, and the
    // rows arrive in document order, so a parent always lands with its
    // children.
    if (input.scope?.length) {
      await tx
        .insert(scopeNodes)
        .values(
          resolveScopeNodes(
            { documentId: document.id, organizationId },
            input.scope,
            new Set()
          ).rows
        );
    }

    const record = await readQuoteRecord(document.id, organizationId, tx);
    if (!record) {
      throw new DocumentError(
        "The quote was written but couldn't be read back.",
        "failed"
      );
    }
    return record;
  });
}
