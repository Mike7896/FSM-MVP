import "server-only";

import { and, asc, desc, eq, isNull, sql } from "drizzle-orm";

import { db } from "@/lib/db";
import {
  changeOrderDetails,
  contractDetails,
  customers,
  documentSignatures,
  documents,
  invoiceDetails,
  jobs,
  licenses,
  organizations,
} from "@/lib/db/schema";
import {
  headerCaptured,
  loadDocument,
  toQuoteRecord,
  type AnyDocument,
  type ContractDocument,
} from "@/lib/documents";
import { collectedForInvoice } from "@/lib/ledger";
import {
  documentActivity,
  type DocumentActivity,
} from "@/lib/queries/document-activity";
import { draftFromRecord, type QuoteDraft } from "@/lib/quote";
import {
  officeAsItStands,
  officeFromHeader,
  type OfficeIdentity,
} from "@/lib/queries/office";
import { contractSignatures } from "@/lib/queries/signatures";
import type { DocumentSignatures } from "@/lib/signing/lines";

/**
 * The Contract — a quote plus what happened to it.
 *
 * Generated the moment a Quote is accepted, carrying the **full agreed scope**
 * rather than a summary: a summary creates a gap between what was agreed and
 * what was described, and that gap lands on the contractor in a dispute.
 *
 * **Nobody edits a Contract.** Everything after it moves through a Change order,
 * which is why this module has reads and no update — and why its signatures come
 * from their own append-only rows rather than columns anyone could overwrite.
 *
 * The contractor's signature is applied at generation; hers is what triggers the
 * deposit ask. That makes **approved but unsigned** a real state rather than a
 * gap, and the page has to be able to show it.
 */

export type ChangeOrderRow = {
  id: string;
  /** `CO-0002`. */
  number: string;
  /** What the contractor named it, in the editor's header. */
  title: string | null;
  whatChanged: string | null;
  priceDeltaCents: number;
  timeImpactDays: number | null;
  status: string;
  sentAt: Date | null;
  approvedAt: Date | null;
  createdAt: Date;
  /** When it last moved — for a declined change, when it was declined. */
  updatedAt: Date;
};

export type ContractView = {
  id: string;
  /** `C-0001`. */
  number: string;
  jobId: string;
  jobName: string | null;
  jobNumber: number;
  customerId: string;
  customerName: string;
  /** Where a copy would go, and whether one may be sent at all. */
  customerEmail: string | null;
  demo: boolean;
  address: string | null;
  /**
   * Everything agreed has been collected. The contract is finished: new work
   * is a new quote, not a change to this one.
   */
  jobPaid: boolean;

  scopeOfWork: string | null;
  terms: string | null;
  agreedPriceCents: number;
  /** Agreed price plus every approved change order — what is owed in total. */
  currentPriceCents: number;

  contractType: string | null;
  depositPercent: number | null;
  moneyUpFront: string | null;
  progressBilling: string | null;
  retainagePercent: number | null;

  status: "generated" | "part_signed" | "signed";
  contractorSignedAt: Date | null;
  contractorSignerName: string | null;
  customerSignedAt: Date | null;
  customerSignerName: string | null;

  businessName: string | null;
  licenseNumber: string | null;
  licenseClass: string | null;

  sourceQuoteId: string | null;
  sourceQuoteNumber: string | null;

  /** Amendments, newest first. v1 stays reachable — that is the point of them. */
  changeOrders: ChangeOrderRow[];
};

/** The job's contract — the newest, if a job has somehow been agreed twice. */
export async function getJobContract(
  jobId: string,
  organizationId: string
): Promise<ContractView | null> {
  const [row] = await db
    .select({
      id: documents.id,
      number: documents.number,
      jobId: documents.jobId,
      status: documents.status,
      summary: documents.summary,
      termsText: documents.termsText,
      header: documents.header,
      sourceDocumentId: documents.sourceDocumentId,
      jobName: jobs.name,
      jobNumber: jobs.number,
      customerId: customers.id,
      address: jobs.address,
      demo: jobs.isDemo,
      jobStatus: jobs.status,
      customerName: customers.name,
      customerEmail: customers.email,
      businessName: organizations.name,
      details: contractDetails,
      licenseNumber: licenses.number,
      licenseClass: licenses.class,
    })
    .from(documents)
    .innerJoin(jobs, eq(documents.jobId, jobs.id))
    .innerJoin(customers, eq(jobs.customerId, customers.id))
    .innerJoin(organizations, eq(documents.organizationId, organizations.id))
    .leftJoin(contractDetails, eq(contractDetails.documentId, documents.id))
    .leftJoin(licenses, eq(contractDetails.licenseId, licenses.id))
    .where(
      and(
        eq(documents.jobId, jobId),
        eq(documents.organizationId, organizationId),
        eq(documents.type, "contract")
      )
    )
    .orderBy(desc(documents.createdAt))
    .limit(1);

  if (!row) return null;

  const [signatures, amendments, [source]] = await Promise.all([
    db
      .select({
        party: documentSignatures.party,
        printedName: documentSignatures.printedName,
        signedAt: documentSignatures.signedAt,
      })
      .from(documentSignatures)
      .where(eq(documentSignatures.documentId, row.id))
      .orderBy(asc(documentSignatures.signedAt)),
    changeOrdersWhere(eq(changeOrderDetails.parentContractId, row.id)),
    row.sourceDocumentId
      ? db
          .select({ number: documents.number })
          .from(documents)
          .where(eq(documents.id, row.sourceDocumentId))
          .limit(1)
      : Promise.resolve([] as { number: string }[]),
  ]);

  const contractor = signatures.find((entry) => entry.party === "contractor");
  const customer = signatures.find((entry) => entry.party === "customer");

  const agreedPriceCents = row.details?.contractSumCents ?? 0;
  const approvedDeltaCents = amendments
    .filter((order) => order.status === "approved")
    .reduce((sum, order) => sum + order.priceDeltaCents, 0);

  // The letterhead it was agreed under. A shop that moves or renews its license
  // does not rewrite a contract somebody signed.
  const frozen = headerCaptured(row.header);

  return {
    id: row.id,
    number: row.number,
    jobId: row.jobId,
    jobName: row.jobName,
    jobNumber: row.jobNumber,
    customerId: row.customerId,
    customerName: row.customerName,
    customerEmail: row.customerEmail,
    demo: row.demo,
    address: row.address,
    jobPaid: row.jobStatus === "paid",
    scopeOfWork: row.summary,
    terms: row.termsText,
    agreedPriceCents,
    currentPriceCents: agreedPriceCents + approvedDeltaCents,
    contractType: row.details?.contractType ?? null,
    depositPercent: row.details?.depositPercent ?? null,
    moneyUpFront: row.details?.moneyUpFront ?? null,
    progressBilling: row.details?.progressBilling ?? null,
    retainagePercent: row.details?.retainagePercent ?? null,
    status: row.status as ContractView["status"],
    contractorSignedAt: contractor?.signedAt ?? null,
    contractorSignerName: contractor?.printedName ?? null,
    customerSignedAt: customer?.signedAt ?? null,
    customerSignerName: customer?.printedName ?? null,
    businessName: frozen
      ? (row.header.businessName ?? null)
      : row.businessName?.trim() || null,
    licenseNumber: frozen
      ? (row.header.licenseNumber ?? null)
      : row.licenseNumber,
    licenseClass: frozen ? (row.header.licenseKind ?? null) : row.licenseClass,
    sourceQuoteId: row.sourceDocumentId,
    sourceQuoteNumber: source?.number ?? null,
    changeOrders: [...amendments].reverse(),
  };
}

/**
 * The contract as a sheet of paper — what its page is drawn from.
 *
 * **One builder, both copies.** The customer's link and the contractor's own
 * page draw the contract from this, so the copy he prints and the copy she
 * signs cannot come apart.
 *
 * The agreement's own scope, drawn the way the quote was. Its tax rate and the
 * terms it was priced under come from the quote it was generated from, carried
 * forward unchanged — nobody edits a contract. The number on the paper is the
 * contract's own: it is a different document from the quote it came from.
 */
export function contractDraft(
  contract: ContractDocument,
  source: AnyDocument | null,
  customer: { id: string; name: string } | null
): QuoteDraft {
  const quote = source?.type === "quote" ? source : null;
  const record = toQuoteRecord(
    quote
      ? {
          ...quote,
          number: contract.number,
          title: contract.title,
          summary: contract.summary,
          scope: contract.scope,
        }
      : { ...contract, type: "quote" as const, details: null },
    customer
  );
  return draftFromRecord(record);
}

export type ContractPaper = {
  draft: QuoteDraft;
  /** The letterhead it was agreed under — not whatever the Office says today. */
  office: OfficeIdentity;
  signatures: DocumentSignatures;
};

/** The contractor's copy of the paper, for the contract page and its print. */
export async function getContractPaper(
  contractId: string,
  organizationId: string
): Promise<ContractPaper | null> {
  const contract = await loadDocument(contractId, organizationId);
  if (!contract || contract.type !== "contract") return null;

  const [source, [customer], signatures] = await Promise.all([
    contract.sourceDocumentId
      ? loadDocument(contract.sourceDocumentId, organizationId)
      : Promise.resolve(null),
    contract.customerId
      ? db
          .select({ id: customers.id, name: customers.name })
          .from(customers)
          .where(eq(customers.id, contract.customerId))
          .limit(1)
      : Promise.resolve([]),
    contractSignatures(contract.id),
  ]);

  return {
    draft: contractDraft(contract, source, customer ?? null),
    office: headerCaptured(contract.header)
      ? officeFromHeader(contract.header)
      : await officeAsItStands(organizationId, contract.details?.licenseId ?? null),
    signatures,
  };
}

/**
 * What has happened to a contract since it was drawn up — the contract page's
 * story and its deposit.
 *
 * Each fact is read from the record that proves it, never a status somebody
 * set: the sends from `document_sends`, every open from the link's view rows,
 * the deposit from its invoice and the money from the ledger. A contract the
 * customer reached straight from the quote they approved has no sends of its
 * own, and that is the ordinary case rather than a gap.
 */
export type ContractStanding = DocumentActivity & {
  /** When the customer accepted the quote — the moment this came to exist. */
  acceptedAt: Date | null;
  /** What the contract asks for up front. Null or zero when it asks nothing. */
  depositCents: number | null;
  /** The invoice that asks for it, once issued. */
  deposit: {
    id: string;
    number: string;
    status: string;
    amountDueCents: number;
    paidCents: number;
    paidAt: Date | null;
  } | null;
};

const INVOICE_ID = sql.raw('"documents"."id"');

export async function getContractStanding(
  contractId: string,
  organizationId: string
): Promise<ContractStanding | null> {
  const [contract] = await db
    .select({
      id: documents.id,
      acceptedAt: contractDetails.acceptedAt,
      depositCents: contractDetails.depositCents,
    })
    .from(documents)
    .leftJoin(contractDetails, eq(contractDetails.documentId, documents.id))
    .where(
      and(
        eq(documents.id, contractId),
        eq(documents.organizationId, organizationId),
        eq(documents.type, "contract")
      )
    )
    .limit(1);
  if (!contract) return null;

  const [activity, [deposit]] = await Promise.all([
    documentActivity(contractId),
    db
      .select({
        id: documents.id,
        number: documents.number,
        status: documents.status,
        amountDueCents: invoiceDetails.amountDueCents,
        paidCents: sql<string>`${collectedForInvoice(INVOICE_ID)}::text`,
        // Paid is settled by money, so the moment is the payment's.
        paidAt: sql<Date | null>`(
          select max(le.occurred_at) from ledger_entries le
          where le.invoice_id = "documents"."id"
            and le.entry_type = 'payment_received'
        )`,
      })
      .from(documents)
      .innerJoin(invoiceDetails, eq(invoiceDetails.documentId, documents.id))
      .where(
        and(
          eq(documents.sourceDocumentId, contractId),
          eq(documents.type, "invoice"),
          eq(invoiceDetails.invoiceType, "deposit"),
          isNull(invoiceDetails.voidedAt)
        )
      )
      .orderBy(desc(documents.createdAt))
      .limit(1),
  ]);

  return {
    acceptedAt: contract.acceptedAt ?? null,
    ...activity,
    depositCents: contract.depositCents ?? null,
    deposit: deposit
      ? {
          id: deposit.id,
          number: deposit.number,
          status: deposit.status,
          amountDueCents: deposit.amountDueCents,
          paidCents: Number(deposit.paidCents),
          paidAt: deposit.paidAt ? new Date(deposit.paidAt) : null,
        }
      : null,
  };
}

/** Change orders on a job, oldest first — the delta editor and the hub's quiet row. */
export async function listChangeOrders(
  jobId: string,
  organizationId: string
): Promise<ChangeOrderRow[]> {
  return changeOrdersWhere(
    and(eq(documents.jobId, jobId), eq(documents.organizationId, organizationId))!
  );
}

function changeOrdersWhere(
  condition: ReturnType<typeof eq>
): Promise<ChangeOrderRow[]> {
  return db
    .select({
      id: documents.id,
      number: documents.number,
      title: documents.title,
      status: documents.status,
      sentAt: documents.sentAt,
      createdAt: documents.createdAt,
      updatedAt: documents.updatedAt,
      whatChanged: changeOrderDetails.whatChanged,
      priceDeltaCents: changeOrderDetails.deltaCents,
      timeImpactDays: changeOrderDetails.timeImpactDays,
      approvedAt: changeOrderDetails.approvedAt,
    })
    .from(documents)
    .innerJoin(changeOrderDetails, eq(changeOrderDetails.documentId, documents.id))
    .where(and(eq(documents.type, "change_order"), condition))
    .orderBy(asc(documents.createdAt));
}
