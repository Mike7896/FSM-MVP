import "server-only";

import { and, eq } from "drizzle-orm";

import { jobSettlement, refreshJobStatus, unbilledStage } from "@/lib/billing";
import type { Settlement } from "@/lib/billing";
import { db } from "@/lib/db";
import { documents, invoiceDetails } from "@/lib/db/schema";
import { formatMoney } from "@/lib/quote/money";

import { DocumentError } from "../errors";
import { ensureShareLink } from "../share-links";
import { createInvoice } from "./create-invoice";

/**
 * `issueFinalInvoice` — Documents §8, operation 4, and the compound one.
 *
 * **It reads both sides of the system.** What is owed comes from the documents
 * — the contract sum plus every approved change order — and what has arrived
 * comes from the ledger fold, so a cheque counts exactly as a card does. The
 * ask is what has not been billed yet; the settlement is the whole story
 * beneath it.
 *
 * **One final bill per job.** A second would be two documents each claiming to
 * be the last word on the same money.
 */
export async function issueFinalInvoice({
  organizationId,
  jobId,
  dueOn,
}: {
  organizationId: string;
  jobId: string;
  dueOn?: string;
}): Promise<{
  invoiceId: string;
  number: string;
  url: string;
  settlement: Settlement;
}> {
  const settlement = await jobSettlement(jobId, organizationId);

  if (!settlement) {
    throw new DocumentError(
      "Nothing is agreed on this job yet, so there's no balance to settle.",
      "invalid"
    );
  }

  const [existing] = await db
    .select({ number: documents.number })
    .from(documents)
    .innerJoin(invoiceDetails, eq(invoiceDetails.documentId, documents.id))
    .where(
      and(
        eq(documents.jobId, jobId),
        eq(documents.organizationId, organizationId),
        eq(documents.type, "invoice"),
        eq(invoiceDetails.invoiceType, "final_balance")
      )
    )
    .limit(1);

  if (existing) {
    throw new DocumentError(
      `${existing.number} is already the final bill on this job. Anything after it is a change order.`
    );
  }

  if (settlement.unbilledCents <= 0) {
    throw new DocumentError(
      `Everything agreed has been billed — ${formatMoney(settlement.billedCents)} of ${formatMoney(settlement.agreedCents)}. There's nothing left to invoice.`
    );
  }

  // The stage that planned the end of the job, when the plan has one. The bill
  // *becomes* it, so the hub shows one row rather than a plan and a bill saying
  // the same thing.
  const stage = await unbilledStage(jobId, "on_completion");

  const invoice = await createInvoice({
    organizationId,
    input: {
      jobId,
      type: "final_balance",
      amountDueCents: settlement.unbilledCents,
      covers: stage?.name?.trim() || "Final balance",
      sourceContractId: settlement.contractId,
      drawScheduleId: stage?.id,
      dueOn,
      issue: true,
    },
  });

  const { url } = await ensureShareLink({ id: invoice.id, jobId }, [
    "view",
    "pay",
  ]);

  // The last bill is out: the work is done and what remains is collection.
  await refreshJobStatus(jobId, organizationId);

  return {
    invoiceId: invoice.id,
    number: invoice.number,
    url,
    settlement,
  };
}
