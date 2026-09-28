import { readChangeOrder } from "@/lib/change-orders/service";
import "server-only";

import { and, asc, desc, eq, gt, isNull, or, sql } from "drizzle-orm";

import { jobSettlement, planFromTerms } from "@/lib/billing";
import { db } from "@/lib/db";
import {
  contractDetails,
  customers,
  documents,
  evidence,
  evidencePhotos,
  invoiceDetails,
  jobs,
  organizations,
  paymentAttempts,
  quoteDetails,
  shareLinks,
  type HeaderSnapshot,
} from "@/lib/db/schema";
import { getConnectedAccount, railsFor } from "@/lib/stripe/connect";
import {
  headerCaptured,
  liveShareLink,
  loadDocument,
  readQuoteRecord,
  shareUrl,
  type DocumentStatus,
} from "@/lib/documents";
import { collectedForInvoice } from "@/lib/ledger";
import { draftFromRecord, totals, type QuoteDraft } from "@/lib/quote";
import { contractDraft } from "@/lib/queries/contracts";
import {
  getOfficeSignature,
  officeAsItStands,
  officeFromHeader,
  type OfficeIdentity,
} from "@/lib/queries/office";
import { contractSignatures } from "@/lib/queries/signatures";
import {
  appliedSignature,
  signsOnQuote,
  type DocumentSignatures,
} from "@/lib/signing/lines";
import { BUCKETS, createSignedDownloadUrl } from "@/lib/supabase/storage";

/**
 * Resolving a share token.
 *
 * **Possession is permission, and the token is the whole authorization.** There
 * is no session here and no organization to scope to — the lookup itself is the
 * check, which is why it must be exact, unguessable, and honour revocation and
 * expiry before returning anything.
 *
 * This is the one read in the app that deliberately does not go through the
 * DAL's membership rules, because the person holding the link has no account
 * and never will. Everything it returns is therefore a **projection**: the
 * customer-visible attributes only, assembled here rather than filtered in the
 * component. Cost, markup and internal notes are absent from what the page
 * renders rather than merely hidden.
 *
 * **One token, one document.** The quote, the contract it became and the
 * deposit that contract asks for each arrive through a link of their own, and
 * each page points at the next — so the link that was texted still leads
 * forward tomorrow, and nothing on one page can act on another document.
 *
 * Recording that a link was opened is a write, and lives with the other
 * document writes: `recordShareView` in `lib/documents`.
 */

type SharedBase = {
  documentId: string;
  office: OfficeIdentity;
  scopes: string[];
  jobAddress: string | null;
  /** A demo, labelled on the page so it can never pass for real work. */
  demo: boolean;
  /**
   * Whose link this is. Not rendered — the page uses it to tell the business's
   * own people apart from the customer, so the business checking its link
   * doesn't read as the customer opening it.
   */
  organizationId: string;
};

/** One payment of the schedule, as the customer reads it. */
export type ScheduledPayment = {
  name: string;
  /** What opens it, in her words — "When the inspection passes". */
  when: string;
  amountCents: number;
};

export type SharedQuote = SharedBase & {
  kind: "quote";
  draft: QuoteDraft;
  status: DocumentStatus;
  /**
   * How the money comes in, shown **before she decides**. The schedule being
   * visible when she accepts is what makes every later ask read as scheduled
   * rather than opportunistic.
   */
  schedule: ScheduledPayment[];
  /** The last day the price holds, when the quote names one. */
  validUntil: string | null;
  /** The contract this quote became once approved, and the link that opens it. */
  contract: { url: string | null; signed: boolean; acceptedAt: Date | null } | null;
  /**
   * The lines at the foot: the business's stored signature ahead of
   * acceptance, the recorded ones after.
   */
  signatures: DocumentSignatures;
  /** Whether she accepts by signing the quote itself — see `signsOnQuote`. */
  signing: boolean;
};

export type SharedSignature = {
  party: "contractor" | "customer";
  printedName: string;
  signatureData: string;
  signedAt: Date;
};

export type SharedContract = SharedBase & {
  kind: "contract";
  number: string;
  status: DocumentStatus;
  /** The contract's own scope, in the shape the customer's page draws. */
  draft: QuoteDraft;
  sourceQuoteNumber: string | null;
  acceptedAt: Date | null;
  customerName: string | null;
  depositCents: number | null;
  signatures: SharedSignature[];
  /** The deposit its signing issued, once it has. */
  deposit: { url: string | null; outstandingCents: number } | null;
};

export type SharedInvoice = SharedBase & {
  kind: "invoice";
  number: string;
  /** Who it's addressed to, as the letterhead captured them. */
  customerName: string | null;
  status: DocumentStatus;
  invoiceType: (typeof invoiceDetails.invoiceType.enumValues)[number];
  covers: string | null;
  dueOn: string | null;
  voided: boolean;
  amountDueCents: number;
  paidCents: number;
  /** The ledger fold, never the face amount — see `resolvePayableInvoice`. */
  outstandingCents: number;
  /** A bank payment still clearing — covers the balance, isn't paid (Billing §8.3). */
  processingCents: number;
  /** The ways she can pay online right now. Both false: no online payment. */
  rails: { card: boolean; ach: boolean };
  /** The agreement it bills, when that has a link of its own. */
  contract: { url: string; number: string } | null;
  /**
   * The proof the work was done — **evidence first, ask second.** A mid-job
   * bill with dated photographs and a plain description answers the question
   * before it is asked; it is the residential substitute for an architect
   * certifying a pay application.
   */
  evidence: {
    summary: string | null;
    completedAt: Date | null;
    photos: { url: string; caption: string | null }[];
  } | null;
  /**
   * On the final balance only: contract, every approved change order,
   * everything already billed and paid, and what remains.
   */
  settlement: {
    contractSumCents: number;
    changeOrders: { number: string; whatChanged: string | null; deltaCents: number }[];
    agreedCents: number;
    priorBills: { number: string; covers: string | null; amountCents: number }[];
    collectedCents: number;
  } | null;
};

export type SharedChangeOrder = SharedBase & {
  kind: "change_order"; number: string; status: string; summary: string | null;
  hash: string; deltaCents: number; baseAmountCents: number; timeImpactDays: number;
  billingMode: string; lines: { description: string; amountCents: number | null }[];
  /** What the contractor named the change. */
  title: string | null;
  customerName: string | null;
  /** The business signs when it sends; the customer's is the approval. */
  signatures: DocumentSignatures;
};
export type SharedDocument = SharedQuote | SharedContract | SharedInvoice | SharedChangeOrder;

/** The live-link conditions every token read shares. */
function live(token: string) {
  const now = new Date();
  return and(
    eq(shareLinks.token, token),
    isNull(shareLinks.revokedAt),
    // A link with no expiry never expires; one with an expiry has to still be
    // inside it. Both are live states.
    or(isNull(shareLinks.expiresAt), gt(shareLinks.expiresAt, now))
  );
}

/**
 * Drizzle renders an embedded column unqualified inside a `sql` template in a
 * projection, which is ambiguous inside the ledger fold's correlated subquery.
 */
const DOCUMENT_ID = sql.raw('"documents"."id"');

export async function resolveShareToken(
  token: string
): Promise<SharedDocument | null> {
  const [link] = await db
    .select({
      documentId: shareLinks.documentId,
      scopes: shareLinks.scopes,
      type: documents.type,
      organizationId: documents.organizationId,
      header: documents.header,
      jobAddress: jobs.address,
      demo: jobs.isDemo,
    })
    .from(shareLinks)
    .innerJoin(documents, eq(shareLinks.documentId, documents.id))
    .innerJoin(jobs, eq(documents.jobId, jobs.id))
    .where(live(token))
    .limit(1);

  if (!link?.documentId) return null;

  const base = {
    documentId: link.documentId,
    scopes: link.scopes ?? [],
    jobAddress: link.header.jobAddress ?? link.jobAddress,
    demo: link.demo,
    organizationId: link.organizationId,
  };

  switch (link.type) {
    case "quote":
      return sharedQuote(base, link.header);
    case "contract":
      return sharedContract(base, link.header);
    case "invoice":
      return sharedInvoice(base, link.header);
    case "change_order":
      return sharedChangeOrder(base);
    default:
      return null;
  }
}

/**
 * A document as its customer's link would show it — **without a link**, and
 * drafts included.
 *
 * For the paper that goes out with a send: the PDF attached to the email and
 * the page drawn in it are built before the document is marked sent (a send
 * that fails must leave it where it was), when a draft invoice would read as
 * "never sent" through a token. The caller has proved the organization; this
 * scopes every read by it, and the result carries no scopes — paper has
 * nothing to press.
 */
export async function resolveDocument(
  documentId: string,
  organizationId: string
): Promise<SharedDocument | null> {
  const [row] = await db
    .select({
      type: documents.type,
      header: documents.header,
      jobAddress: jobs.address,
      demo: jobs.isDemo,
    })
    .from(documents)
    .innerJoin(jobs, eq(documents.jobId, jobs.id))
    .where(
      and(eq(documents.id, documentId), eq(documents.organizationId, organizationId))
    )
    .limit(1);
  if (!row) return null;

  const base = {
    documentId,
    scopes: [],
    jobAddress: row.header.jobAddress ?? row.jobAddress,
    demo: row.demo,
    organizationId,
  };

  switch (row.type) {
    case "quote":
      return sharedQuote(base, row.header);
    case "contract":
      return sharedContract(base, row.header);
    case "invoice":
      return sharedInvoice(base, row.header, { draft: true });
    case "change_order":
      return sharedChangeOrder(base, { draft: true });
    default:
      return null;
  }
}

async function sharedChangeOrder(
  base: Base,
  options?: { draft?: boolean }
): Promise<SharedChangeOrder | null> {
  const { doc, hash } = await readChangeOrder(base.documentId, base.organizationId);
  // A draft was never sent to anyone — except onto the paper that goes with it.
  if (doc.status === "draft" && !options?.draft) return null;

  const signed = (party: "contractor" | "customer") => {
    const signature = doc.signatures.find((entry) => entry.party === party);
    return signature
      ? {
          mark: signature.signatureData,
          printedName: signature.printedName,
          signedAt: signature.signedAt,
        }
      : null;
  };

  return {
    ...base,
    office: officeFromHeader(doc.header),
    kind: "change_order",
    number: doc.number,
    status: doc.status,
    summary: doc.summary,
    title: doc.title?.trim() || null,
    customerName: doc.header.customerName ?? null,
    hash,
    deltaCents: doc.details!.deltaCents,
    baseAmountCents: doc.details!.baseAmountCents ?? 0,
    timeImpactDays: doc.details!.timeImpactDays ?? 0,
    billingMode: doc.details!.billingMode,
    lines: doc.scope.map((n) => ({
      description: n.description,
      amountCents: ["item", "allowance"].includes(n.nodeType)
        ? Math.round(Number(n.quantity) * n.sellPriceCents)
        : null,
    })),
    signatures: { contractor: signed("contractor"), customer: signed("customer") },
  };
}

type Base = Omit<SharedBase, "office">;

async function sharedQuote(
  base: Base,
  header: HeaderSnapshot
): Promise<SharedQuote | null> {
  const record = await readQuoteRecord(base.documentId, base.organizationId);
  if (!record) return null;

  const [[details], [contract]] = await Promise.all([
    db
      .select({
        validUntil: quoteDetails.validUntil,
        depositPercent: quoteDetails.depositPercent,
        progressBilling: quoteDetails.progressBilling,
        // The shop's pattern as it stood when this quote was written.
        drawPattern: quoteDetails.drawPattern,
      })
      .from(quoteDetails)
      .where(eq(quoteDetails.documentId, base.documentId))
      .limit(1),
    db
      .select({
        id: documents.id,
        status: documents.status,
        acceptedAt: contractDetails.acceptedAt,
      })
      .from(documents)
      .leftJoin(contractDetails, eq(contractDetails.documentId, documents.id))
      .where(
        and(
          eq(documents.sourceDocumentId, base.documentId),
          eq(documents.type, "contract")
        )
      )
      .orderBy(desc(documents.createdAt))
      .limit(1),
  ]);

  const [contractLink, stored] = await Promise.all([
    contract ? liveShareLink(contract.id) : Promise.resolve(null),
    // Read live rather than snapshotted: nothing is signed until she signs,
    // and at that moment the Office's signature is what goes on the contract.
    getOfficeSignature(base.organizationId),
  ]);
  const draft = draftFromRecord(record);
  const open = record.status === "sent" || record.status === "viewed";

  // Priced off the same total the page shows, so the schedule and the figure
  // above it can never disagree.
  const schedule = planFromTerms({
    totalCents: totals(draft).totalCents,
    depositPercent: details?.depositPercent ?? null,
    draws: details?.progressBilling === "draws",
    pattern: details?.drawPattern ?? null,
  }).map((stage) => ({
    name: stage.name,
    when: WHEN[stage.gate],
    amountCents: stage.amountCents,
  }));

  return {
    ...base,
    kind: "quote",
    draft,
    status: record.status,
    // One payment is just the total again, said twice.
    schedule: schedule.length > 1 ? schedule : [],
    // **The letterhead on the page is the one it was sent with** (Documents §2).
    // Only a link opened before any send — which the product never hands out —
    // falls back to the Office as it stands today.
    office: headerCaptured(header)
      ? officeFromHeader(header)
      : await officeAsItStands(base.organizationId, record.licenseId),
    validUntil: details?.validUntil ?? null,
    contract: contract
      ? {
          url: contractLink ? shareUrl(contractLink.token) : null,
          signed: contract.status === "signed",
          acceptedAt: contract.acceptedAt ?? null,
        }
      : null,
    signatures: contract
      ? await contractSignatures(contract.id)
      : { contractor: appliedSignature(stored), customer: null },
    signing: open && !contract && signsOnQuote(draft, stored),
  };
}

async function sharedContract(
  base: Base,
  header: HeaderSnapshot
): Promise<SharedContract | null> {
  const contract = await loadDocument(base.documentId, base.organizationId);
  if (!contract || contract.type !== "contract") return null;

  const [source, [customer], [deposit]] = await Promise.all([
    contract.sourceDocumentId
      ? loadDocument(contract.sourceDocumentId, base.organizationId)
      : Promise.resolve(null),
    contract.customerId
      ? db
          .select({ id: customers.id, name: customers.name })
          .from(customers)
          .where(eq(customers.id, contract.customerId))
          .limit(1)
      : Promise.resolve([]),
    db
      .select({
        id: documents.id,
        amountDueCents: invoiceDetails.amountDueCents,
        paidCents: sql<string>`${collectedForInvoice(DOCUMENT_ID)}::text`,
      })
      .from(documents)
      .innerJoin(invoiceDetails, eq(invoiceDetails.documentId, documents.id))
      .where(
        and(
          eq(documents.sourceDocumentId, contract.id),
          eq(documents.type, "invoice"),
          eq(invoiceDetails.invoiceType, "deposit"),
          isNull(invoiceDetails.voidedAt)
        )
      )
      .orderBy(desc(documents.createdAt))
      .limit(1),
  ]);

  const quote = source?.type === "quote" ? source : null;

  const depositLink = deposit ? await liveShareLink(deposit.id) : null;

  return {
    ...base,
    kind: "contract",
    number: contract.number,
    status: contract.status,
    draft: contractDraft(contract, source, customer ?? null),
    // Carried over from the quote at generation: the letterhead it was agreed
    // under, not whatever the Office says today.
    office: headerCaptured(header)
      ? officeFromHeader(header)
      : await officeAsItStands(
          base.organizationId,
          contract.details?.licenseId ?? null
        ),
    sourceQuoteNumber: quote?.number ?? null,
    acceptedAt: contract.details?.acceptedAt ?? null,
    customerName: customer?.name ?? null,
    depositCents: contract.details?.depositCents ?? null,
    signatures: contract.signatures.map((signature) => ({
      party: signature.party as SharedSignature["party"],
      printedName: signature.printedName,
      signatureData: signature.signatureData,
      signedAt: signature.signedAt,
    })),
    deposit: deposit
      ? {
          url: depositLink ? shareUrl(depositLink.token) : null,
          outstandingCents: Math.max(
            deposit.amountDueCents - Number(deposit.paidCents),
            0
          ),
        }
      : null,
  };
}

async function sharedInvoice(
  base: Base,
  header: HeaderSnapshot,
  options?: { draft?: boolean }
): Promise<SharedInvoice | null> {
  const [invoice] = await db
    .select({
      number: documents.number,
      status: documents.status,
      jobId: documents.jobId,
      sourceDocumentId: documents.sourceDocumentId,
      invoiceType: invoiceDetails.invoiceType,
      covers: invoiceDetails.covers,
      amountDueCents: invoiceDetails.amountDueCents,
      dueOn: invoiceDetails.dueOn,
      voidedAt: invoiceDetails.voidedAt,
      paidCents: sql<string>`${collectedForInvoice(DOCUMENT_ID)}::text`,
    })
    .from(documents)
    .innerJoin(invoiceDetails, eq(invoiceDetails.documentId, documents.id))
    .where(eq(documents.id, base.documentId))
    .limit(1);

  // A draft was never sent to anyone — except onto the paper that goes with it.
  if (!invoice || (invoice.status === "draft" && !options?.draft)) return null;

  const [source] = invoice.sourceDocumentId
    ? await db
        .select({
          id: documents.id,
          number: documents.number,
          header: documents.header,
        })
        .from(documents)
        .where(eq(documents.id, invoice.sourceDocumentId))
        .limit(1)
    : [];

  const sourceLink = source ? await liveShareLink(source.id) : null;

  // What this bill is for, proved. Photos live in a private bucket, so each
  // view mints its own short-lived read URL.
  const [proof] = await db
    .select({
      id: evidence.id,
      summary: evidence.summary,
      completedAt: evidence.completedAt,
    })
    .from(evidence)
    .where(eq(evidence.invoiceId, base.documentId))
    .orderBy(desc(evidence.createdAt))
    .limit(1);

  const photos = proof
    ? await db
        .select({
          fileUrl: evidencePhotos.fileUrl,
          caption: evidencePhotos.caption,
        })
        .from(evidencePhotos)
        .where(eq(evidencePhotos.evidenceId, proof.id))
        .orderBy(asc(evidencePhotos.position))
    : [];

  const shown = (
    await Promise.all(
      photos.map(async (photo) => ({
        url: await signQuietly(photo.fileUrl),
        caption: photo.caption,
      }))
    )
  ).filter((photo): photo is { url: string; caption: string | null } =>
    Boolean(photo.url)
  );

  // The last bill carries the whole story of the money; the others carry their
  // own amount and nothing else.
  const settlement =
    invoice.invoiceType === "final_balance"
      ? await jobSettlement(invoice.jobId, base.organizationId)
      : null;

  // The invoice's own letterhead if it has one, else the one on the agreement
  // it bills, else the Office as it stands.
  const letterhead = headerCaptured(header)
    ? header
    : source && headerCaptured(source.header)
      ? source.header
      : null;

  const paidCents = Number(invoice.paidCents);
  const voided = invoice.voidedAt !== null || invoice.status === "void";

  return {
    ...base,
    kind: "invoice",
    number: invoice.number,
    status: invoice.status,
    invoiceType: invoice.invoiceType,
    covers: invoice.covers,
    dueOn: invoice.dueOn,
    voided,
    amountDueCents: invoice.amountDueCents,
    paidCents,
    outstandingCents: voided
      ? 0
      : Math.max(invoice.amountDueCents - paidCents, 0),
    processingCents: await processingCentsOf(base.documentId),
    rails: await onlineRails(base.organizationId),
    office: letterhead
      ? officeFromHeader(letterhead)
      : await officeAsItStands(base.organizationId, null),
    customerName:
      header.customerName ?? source?.header?.customerName ?? null,
    contract:
      source && sourceLink
        ? { url: shareUrl(sourceLink.token), number: source.number }
        : null,
    evidence: proof
      ? {
          summary: proof.summary,
          completedAt: proof.completedAt,
          photos: shown,
        }
      : null,
    settlement: settlement
      ? {
          contractSumCents: settlement.contractSumCents,
          changeOrders: settlement.changeOrders.map((change) => ({
            number: change.number,
            whatChanged: change.whatChanged,
            deltaCents: change.deltaCents,
          })),
          agreedCents: settlement.agreedCents,
          // Everything asked for before this one.
          priorBills: settlement.bills
            .filter((bill) => bill.id !== base.documentId)
            .map((bill) => ({
              number: bill.number,
              covers: bill.covers,
              amountCents: bill.amountCents,
            })),
          collectedCents: settlement.collectedCents,
        }
      : null,
  };
}

/** What opens each payment, in the customer's words. */
const WHEN: Record<string, string> = {
  on_acceptance: "When you approve this",
  phase_complete: "When that stage is done",
  inspection_passed: "When the inspection passes",
  on_completion: "When the work's finished",
};

/** A photo that won't sign is a missing picture, not a broken page. */
async function signQuietly(path: string): Promise<string | null> {
  try {
    return await createSignedDownloadUrl(BUCKETS.jobAttachments, path);
  } catch {
    return null;
  }
}

/* ── Paying from the link ─────────────────────────────────────────────── */

export type PayableInvoice = {
  invoiceId: string;
  jobId: string;
  organizationId: string;
  customerId: string;
  customerName: string;
  businessName: string | null;
  /** What the bill was issued for. */
  amountDueCents: number;
  /** What is still owed after everything the ledger has recorded. */
  outstandingCents: number;
  currency: string;
};

/**
 * The invoice behind a share token, and what is left to pay on it.
 *
 * **Outstanding is the ledger fold, not the invoice's face amount.** A customer
 * who paid half by cheque and opens the link a week later must be asked for the
 * half that remains — charging the full amount because the cheque lived
 * somewhere else is the exact failure the single ledger was built to prevent.
 *
 * Returns null for an unknown, revoked or expired token, for a link that names
 * something other than an invoice, and for an invoice that is settled, voided or
 * still a draft. The caller turns all of those into a 404 rather than an
 * explanation: telling a stranger that a token *used* to be valid is telling
 * them a token exists.
 *
 * **A demo invoice is never payable.** Money on a demo is not money, and a real
 * card charged against a practice job is the one mistake that cannot be
 * explained away as a label.
 */
export async function resolvePayableInvoice(
  token: string
): Promise<PayableInvoice | null> {
  const [row] = await db
    .select({
      scopes: shareLinks.scopes,
      invoiceId: documents.id,
      type: documents.type,
      status: documents.status,
      jobId: documents.jobId,
      organizationId: documents.organizationId,
      demo: jobs.isDemo,
      customerId: customers.id,
      customerName: customers.name,
      businessName: organizations.name,
      amountDueCents: invoiceDetails.amountDueCents,
      voidedAt: invoiceDetails.voidedAt,
      paidCents: sql<string>`${collectedForInvoice(DOCUMENT_ID)}::text`,
    })
    .from(shareLinks)
    .innerJoin(documents, eq(shareLinks.documentId, documents.id))
    .innerJoin(invoiceDetails, eq(invoiceDetails.documentId, documents.id))
    .innerJoin(jobs, eq(documents.jobId, jobs.id))
    .innerJoin(customers, eq(jobs.customerId, customers.id))
    .innerJoin(organizations, eq(documents.organizationId, organizations.id))
    .where(live(token))
    .limit(1);

  if (!row || row.type !== "invoice" || row.demo) return null;

  // The token has to actually grant paying. A link sent so it could be *read*
  // is not a link that may charge a card.
  if (!row.scopes?.includes("pay")) return null;

  if (row.voidedAt || row.status === "draft" || row.status === "void") {
    return null;
  }

  const outstandingCents = row.amountDueCents - Number(row.paidCents);
  if (outstandingCents <= 0) return null;

  return {
    invoiceId: row.invoiceId,
    jobId: row.jobId,
    organizationId: row.organizationId,
    customerId: row.customerId,
    customerName: row.customerName,
    businessName: row.businessName,
    amountDueCents: row.amountDueCents,
    outstandingCents,
    currency: "usd",
  };
}

/** Money on its way for an invoice — reserved, not paid (Billing §8.3). */
async function processingCentsOf(invoiceId: string): Promise<number> {
  const [row] = await db
    .select({ cents: sql<number>`coalesce(sum(${paymentAttempts.amountCents}), 0)::int` })
    .from(paymentAttempts)
    .where(and(eq(paymentAttempts.invoiceId, invoiceId), eq(paymentAttempts.status, "processing")));
  return row?.cents ?? 0;
}

/** Card and bank, as the contractor's Stripe account can take them now. */
async function onlineRails(organizationId: string): Promise<{ card: boolean; ach: boolean }> {
  const account = await getConnectedAccount(organizationId);
  if (!account?.chargesEnabled) return { card: false, ach: false };
  try {
    return await railsFor(account.stripeAccountId);
  } catch (error) {
    console.error("[share] couldn't read payment capabilities:", error);
    return { card: true, ach: false };
  }
}
