import "server-only";

import { and, asc, desc, eq, isNull, notInArray, sql } from "drizzle-orm";

import { db } from "@/lib/db";
import {
  changeOrderDetails,
  contractDetails,
  documents,
  invoiceDetails,
} from "@/lib/db/schema";
import { collectedForInvoice } from "@/lib/ledger";

/**
 * THE SETTLEMENT — what the final bill has to say, and what the job's money
 * adds up to on the way there.
 *
 * **It reads both sides of the system**: the documents for what was agreed and
 * what has been asked for, and the ledger fold for what actually arrived. That
 * is the whole reason the final invoice is the compound operation — a balance
 * computed from invoices alone would be wrong the moment somebody paid by
 * cheque.
 *
 * Four numbers, in the order a contractor says them: what was agreed (the
 * contract plus every approved change order), what has been billed, what has
 * been collected, and what is left.
 */

const DOCUMENT_ID = sql.raw('"documents"."id"');

export type SettlementBill = {
  id: string;
  number: string;
  type: (typeof invoiceDetails.invoiceType.enumValues)[number];
  covers: string | null;
  amountCents: number;
  paidCents: number;
  issuedAt: Date | null;
};

export type SettlementChange = {
  id: string;
  number: string;
  whatChanged: string | null;
  deltaCents: number;
};

export type Settlement = {
  /** The agreement everything here is measured against. */
  contractId: string;
  contractSumCents: number;
  changeOrders: SettlementChange[];
  changeOrderCents: number;
  /** The contract plus every approved change order — what is owed in total. */
  agreedCents: number;
  bills: SettlementBill[];
  billedCents: number;
  collectedCents: number;
  /** Agreed, less everything billed — what a final invoice would ask for. */
  unbilledCents: number;
  /** Agreed, less everything collected — what is still owed on the job. */
  outstandingCents: number;
};

/** Anything that can read: the pool, or a check script's transaction. */
type Reader = Pick<typeof db, "select">;

export async function jobSettlement(
  jobId: string,
  organizationId: string,
  on: Reader = db
): Promise<Settlement | null> {
  const [contract] = await on
    .select({
      id: documents.id,
      contractSumCents: contractDetails.contractSumCents,
    })
    .from(documents)
    .innerJoin(contractDetails, eq(contractDetails.documentId, documents.id))
    .where(
      and(
        eq(documents.jobId, jobId),
        eq(documents.organizationId, organizationId),
        eq(documents.type, "contract")
      )
    )
    .orderBy(desc(documents.createdAt))
    .limit(1);

  if (!contract) return null;

  const [changes, bills] = await Promise.all([
    on
      .select({
        id: documents.id,
        number: documents.number,
        whatChanged: changeOrderDetails.whatChanged,
        deltaCents: changeOrderDetails.deltaCents,
      })
      .from(documents)
      .innerJoin(
        changeOrderDetails,
        eq(changeOrderDetails.documentId, documents.id)
      )
      .where(
        and(
          eq(changeOrderDetails.parentContractId, contract.id),
          eq(documents.status, "approved")
        )
      )
      .orderBy(asc(documents.createdAt)),

    on
      .select({
        id: documents.id,
        number: documents.number,
        type: invoiceDetails.invoiceType,
        covers: invoiceDetails.covers,
        amountCents: invoiceDetails.amountDueCents,
        issuedAt: documents.issuedAt,
        paidCents: sql<string>`${collectedForInvoice(DOCUMENT_ID)}::text`,
      })
      .from(documents)
      .innerJoin(invoiceDetails, eq(invoiceDetails.documentId, documents.id))
      .where(
        and(
          eq(documents.jobId, jobId),
          eq(documents.organizationId, organizationId),
          eq(documents.type, "invoice"),
          // A draft was never asked for, and a voided bill was withdrawn.
          notInArray(documents.status, ["draft", "void"]),
          isNull(invoiceDetails.voidedAt)
        )
      )
      .orderBy(asc(documents.createdAt)),
  ]);

  const changeOrderCents = changes.reduce(
    (sum, change) => sum + change.deltaCents,
    0
  );
  const agreedCents = contract.contractSumCents + changeOrderCents;

  const settled = bills.map((bill) => ({
    ...bill,
    paidCents: Number(bill.paidCents),
  }));

  const billedCents = settled.reduce((sum, bill) => sum + bill.amountCents, 0);
  const collectedCents = settled.reduce((sum, bill) => sum + bill.paidCents, 0);

  return {
    contractId: contract.id,
    contractSumCents: contract.contractSumCents,
    changeOrders: changes,
    changeOrderCents,
    agreedCents,
    bills: settled,
    billedCents,
    collectedCents,
    unbilledCents: agreedCents - billedCents,
    outstandingCents: agreedCents - collectedCents,
  };
}
