import "server-only";

import { and, eq } from "drizzle-orm";

import { db } from "@/lib/db";
import {
  customers,
  documents,
  jobs,
  quoteDetails,
  scopeNodes,
} from "@/lib/db/schema";
import type { QuoteRecord } from "@/lib/quote";

import { DocumentError } from "../errors";
import { readQuoteRecord } from "../quote-record";
import { resolveScopeNodes, type IncomingScopeNode } from "../scope-write";

/**
 * `duplicateQuote` — Documents §8, operation 8.
 *
 * **The cheapest form the price book takes.** The fastest way to price the next
 * panel swap is the last panel swap; this is what sits behind the dashboard's
 * Quick start and the quotes list's Duplicate.
 *
 * **A copy is a new Job by default.** A duplicated quote is nearly always the
 * same kind of work for a different customer, so unless a `jobId` is named it
 * gets a Job and a Customer of its own rather than a stranger's quote piled
 * onto an existing job.
 *
 * **Rows are copied as `duplicated`**, not as their original source. Where a row
 * came from is what the price book learns from, and a copy of an AI-drafted row
 * is not itself AI-drafted.
 *
 * Always a fresh draft, never linked by `source_document_id` — that link means
 * "a revision of", which is `reviseQuote`, and a duplicate is a new document
 * that happens to start from an old one.
 */
export async function duplicateQuote({
  organizationId,
  userId,
  quoteId,
  input,
}: {
  organizationId: string;
  userId: string;
  quoteId: string;
  input: {
    /** Copy onto a job that already exists rather than making one. */
    jobId?: string;
    customerId?: string;
    customerName?: string;
    title?: string;
  };
}): Promise<QuoteRecord> {
  const source = await readQuoteRecord(quoteId, organizationId);
  if (!source) {
    throw new DocumentError("No quote with that id in this shop.", "not_found");
  }

  return db.transaction(async (tx) => {
    let jobId = input.jobId ?? null;
    let customerId = input.customerId ?? null;

    if (jobId) {
      const [existing] = await tx
        .select({ id: jobs.id, customerId: jobs.customerId })
        .from(jobs)
        .where(and(eq(jobs.id, jobId), eq(jobs.organizationId, organizationId)))
        .limit(1);
      if (!existing) {
        throw new DocumentError("No job with that id in this shop.", "not_found");
      }
      customerId = existing.customerId;
    }

    if (!jobId) {
      if (customerId) {
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

      if (!customerId) {
        const [customer] = await tx
          .insert(customers)
          .values({
            organizationId,
            name: input.customerName?.trim() || "New customer",
          })
          .returning({ id: customers.id });
        customerId = customer.id;
      }

      const [job] = await tx
        .insert(jobs)
        .values({
          organizationId,
          customerId,
          name: input.title ?? source.title,
          packId: source.packId,
          createdBy: userId,
        })
        .returning({ id: jobs.id });
      jobId = job.id;
    }

    const [document] = await tx
      .insert(documents)
      .values({
        organizationId,
        jobId,
        customerId,
        type: "quote",
        number: "",
        // Copying `sent` or `accepted` would assert something about a document
        // nobody has seen.
        status: "draft",
        title: input.title ?? source.title,
        summary: source.summary,
        packId: source.packId,
        createdBy: userId,
      })
      .returning({ id: documents.id });

    await tx.insert(quoteDetails).values({
      documentId: document.id,
      taxRate: source.taxRate == null ? null : String(source.taxRate),
      licenseId: source.licenseId,
      contractType: source.contractType as never,
      priceStructure: source.priceStructure as never,
      scopeDetail: source.scopeDetail as never,
      pricingMethod: source.pricingMethod as never,
      estimatingMethod: source.estimatingMethod as never,
      estimateClass: source.estimateClass as never,
      billingTrigger: source.billingTrigger as never,
      moneyUpFront: source.moneyUpFront as never,
      depositPercent: source.depositPercent,
      progressBilling: source.progressBilling as never,
      retainagePercent: source.retainagePercent,
      capCents: source.capCents,
      signatureLines: source.signatureLines,
    });

    // The tree is copied **whole**, shape included — the shape is most of what
    // made the original worth duplicating. Source rows arrive in document
    // order, so each parent's position in that order is its index here, and
    // none of the source's ids come across.
    const indexOf = new Map(source.scope.map((node, index) => [node.id, index]));

    const nodes: IncomingScopeNode[] = source.scope.map((node) => ({
      id: null,
      parentIndex:
        node.parentNodeId === null
          ? null
          : (indexOf.get(node.parentNodeId) ?? null),
      nodeType: node.nodeType,
      section: node.section,
      description: node.description,
      quantity: Number(node.quantity),
      unit: node.unit,
      unitCostCents: node.unitCostCents,
      markupBps: node.markupBps,
      sellPriceCents: node.sellPriceCents,
      taxable: node.taxable,
      optional: node.optional,
      breakdown: node.breakdown,
      position: node.position,
      source: "duplicated",
    }));

    if (nodes.length) {
      await tx
        .insert(scopeNodes)
        .values(
          resolveScopeNodes(
            { documentId: document.id, organizationId },
            nodes,
            new Set()
          ).rows
        );
    }

    const record = await readQuoteRecord(document.id, organizationId, tx);
    if (!record) {
      throw new DocumentError(
        "The copy was written but couldn't be read back.",
        "failed"
      );
    }
    return record;
  });
}
