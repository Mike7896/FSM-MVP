import { createHash } from "node:crypto";
import type { QuoteDocument } from "@/lib/documents/types";
import { documentHash } from "./hash";

/** A review token, separate from historical signature hashes. Opening a quote
 * changes its status/timestamps, but must not invalidate the page being read. */
export function quoteReviewHash(quote: QuoteDocument): string {
  return createHash("sha256").update(JSON.stringify([
    documentHash(quote), quote.id, quote.customerId,
    quote.details?.validUntil, quote.details?.billingTrigger,
    quote.details?.moneyUpFront, quote.details?.progressBilling,
    quote.details?.drawPattern, quote.details?.phaseSplit,
    quote.details?.signatureLines, quote.details?.commitmentSummary,
    quote.details?.priceStructure, quote.details?.scopeDetail,
    quote.scope.map(node => [node.id, node.parentNodeId, node.position, node.phaseKey, node.breakdown]),
  ])).digest("hex");
}
