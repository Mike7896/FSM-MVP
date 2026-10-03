import "server-only";

import { eq } from "drizzle-orm";

import { db } from "@/lib/db";
import { customers } from "@/lib/db/schema";
import type { QuoteRecord } from "@/lib/quote";

import { loadDocument, type Executor } from "./repository";
import type { QuoteDocument } from "./types";

/**
 * A quote in the shape the editor and the API speak.
 *
 * Documents §10's `Quote` is the model — a spine row, its details, its flat
 * Scope. The editor wants that flattened one step further: the five decisions
 * as one object, the customer's name beside the id, and a single `frozen` it
 * can check before it offers an edit the database would refuse. This is that
 * projection, in one place, so the API, the pages and every operation that
 * writes a quote and hands it back agree on it.
 */

/**
 * One quote, read back.
 *
 * Takes `on` so an operation that has just written the quote reads it inside
 * the same transaction — outside it, the read would see the state from before
 * its own uncommitted writes.
 */
export async function readQuoteRecord(
  quoteId: string,
  organizationId: string,
  on: Executor = db
): Promise<QuoteRecord | null> {
  const document = await loadDocument(quoteId, organizationId, on);
  if (!document || document.type !== "quote") return null;

  const [customer] = document.customerId
    ? await on
        .select({ id: customers.id, name: customers.name })
        .from(customers)
        .where(eq(customers.id, document.customerId))
        .limit(1)
    : [];

  return toQuoteRecord(document, customer ?? null);
}

export function toQuoteRecord(
  document: QuoteDocument,
  customer: { id: string; name: string } | null
): QuoteRecord {
  const details = document.details;

  return {
    id: document.id,
    number: document.number,
    jobId: document.jobId,
    customerId: customer?.id ?? document.customerId,
    customerName: customer?.name ?? null,
    title: document.title,
    summary: document.summary,
    taxRate: details?.taxRate ?? null,
    status: document.status as QuoteRecord["status"],
    frozen: document.frozenAt !== null,
    licenseId: details?.licenseId ?? null,
    packId: document.packId,
    contractType: details?.contractType ?? null,
    priceStructure: details?.priceStructure ?? null,
    scopeDetail: details?.scopeDetail ?? null,
    pricingMethod: details?.pricingMethod ?? null,
    estimatingMethod: details?.estimatingMethod ?? null,
    estimateClass: details?.estimateClass ?? null,
    billingTrigger: details?.billingTrigger ?? null,
    moneyUpFront: details?.moneyUpFront ?? null,
    depositPercent: details?.depositPercent ?? null,
    progressBilling: details?.progressBilling ?? null,
    retainagePercent: details?.retainagePercent ?? null,
    capCents: details?.capCents ?? null,
    signatureLines: details?.signatureLines ?? true,
    scope: document.scope.map((node) => ({
      id: node.id,
      referencesNodeId: node.referencesNodeId,
      referenceKind: node.referenceKind === "supersedes" ? null : node.referenceKind,
      parentNodeId: node.parentNodeId,
      nodeType: node.nodeType,
      section: node.section,
      description: node.description,
      quantity: node.quantity,
      unit: node.unit,
      unitCostCents: node.unitCostCents,
      markupBps: node.markupBps,
      sellPriceCents: node.sellPriceCents,
      taxable: node.taxable,
      optional: node.optional,
      breakdown: node.breakdown,
      position: node.position,
      source: node.source,
    })),
  };
}
