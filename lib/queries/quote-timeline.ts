import "server-only";

import { and, asc, desc, eq, sql } from "drizzle-orm";

import { db } from "@/lib/db";
import {
  contractDetails,
  customers,
  documentSends,
  documentSignatures,
  documents,
  invoiceDetails,
  jobs,
  shareLinkViews,
  shareLinks,
} from "@/lib/db/schema";
import { liveShareLink, readQuoteRecord, shareUrl } from "@/lib/documents";
import { draftFromRecord, totals } from "@/lib/quote";

/**
 * Where a sent quote stands — what screen 11 draws.
 *
 * **Her behaviour, as a timeline.** Sent, opened, accepted, signed, paid — each
 * step read from the record that proves it, never a status somebody set: the
 * sends from `document_sends`, every open from the link's view rows, acceptance
 * from the Contract it generated, the signatures from that Contract's signature
 * rows, the deposit from its Invoice. A step with nothing behind it comes back
 * empty and is drawn quiet rather than hidden, so the money workflow shows its
 * own shape before he has run it.
 *
 * Takes an `organizationId` the caller has proved; the record read is scoped by
 * it, so a quote from another business never comes back at all.
 */

export type QuoteTimeline = {
  quote: {
    id: string;
    number: string;
    title: string;
    status: string;
    jobId: string;
    demo: boolean;
    totalCents: number;
    /** Null when no deposit is asked for. */
    depositCents: number | null;
    /** ISO strings throughout — this crosses to a Client Component. */
    sentAt: string | null;
    /** How it last went out, and to whom. */
    sentChannel: string | null;
    sentTo: string | null;
    /** When she said yes — the moment the Contract came into being. */
    acceptedAt: string | null;
  };
  customer: { name: string; email: string | null; phone: string | null };
  /** The live link she holds. Null until the quote has been sent. */
  url: string | null;
  /** Every open, newest first. */
  opens: string[];
  contract: {
    contractorSignedAt: string | null;
    customerSignedAt: string | null;
  } | null;
  depositPaidAt: string | null;
};

export async function getQuoteTimeline(
  quoteId: string,
  organizationId: string
): Promise<QuoteTimeline | null> {
  const record = await readQuoteRecord(quoteId, organizationId);
  if (!record) return null;

  const [meta] = await db
    .select({
      sentAt: documents.sentAt,
      demo: jobs.isDemo,
      email: customers.email,
      phone: customers.phone,
    })
    .from(documents)
    .innerJoin(jobs, eq(documents.jobId, jobs.id))
    .leftJoin(customers, eq(documents.customerId, customers.id))
    .where(eq(documents.id, quoteId))
    .limit(1);

  const [link, opens, [lastSend], [contract], [deposit]] = await Promise.all([
    liveShareLink(quoteId),
    db
      .select({ viewedAt: shareLinkViews.viewedAt })
      .from(shareLinkViews)
      .innerJoin(shareLinks, eq(shareLinkViews.shareLinkId, shareLinks.id))
      .where(eq(shareLinks.documentId, quoteId))
      .orderBy(desc(shareLinkViews.viewedAt))
      .limit(50),
    db
      .select({
        channel: documentSends.channel,
        recipient: documentSends.recipient,
      })
      .from(documentSends)
      .where(eq(documentSends.documentId, quoteId))
      .orderBy(desc(documentSends.sentAt))
      .limit(1),
    // The Contract this quote became, if she accepted it.
    db
      .select({ id: documents.id, acceptedAt: contractDetails.acceptedAt })
      .from(documents)
      .leftJoin(contractDetails, eq(contractDetails.documentId, documents.id))
      .where(
        and(
          eq(documents.sourceDocumentId, quoteId),
          eq(documents.type, "contract")
        )
      )
      .limit(1),
    // Paid is settled by money, so the moment is the payment's, not a status
    // change's.
    db
      .select({
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
          eq(documents.jobId, record.jobId),
          eq(documents.type, "invoice"),
          eq(invoiceDetails.invoiceType, "deposit"),
          eq(documents.status, "paid")
        )
      )
      .limit(1),
  ]);

  const signatures = contract
    ? await db
        .select({
          party: documentSignatures.party,
          signedAt: documentSignatures.signedAt,
        })
        .from(documentSignatures)
        .where(eq(documentSignatures.documentId, contract.id))
        .orderBy(asc(documentSignatures.signedAt))
    : [];

  const signedAt = (party: "contractor" | "customer") =>
    signatures.find((row) => row.party === party)?.signedAt.toISOString() ??
    null;

  const draft = draftFromRecord(record);
  const sums = totals(draft);

  return {
    quote: {
      id: record.id,
      number: record.number,
      title: draft.title,
      status: record.status,
      jobId: record.jobId,
      demo: meta?.demo ?? false,
      totalCents: sums.totalCents,
      depositCents: sums.depositCents,
      sentAt: meta?.sentAt?.toISOString() ?? null,
      sentChannel: lastSend?.channel ?? null,
      sentTo: lastSend?.recipient ?? null,
      acceptedAt: contract?.acceptedAt?.toISOString() ?? null,
    },
    customer: {
      name: draft.customerName,
      email: meta?.email ?? null,
      phone: meta?.phone ?? null,
    },
    url: link ? shareUrl(link.token) : null,
    opens: opens.map((open) => open.viewedAt.toISOString()),
    contract: contract
      ? {
          contractorSignedAt: signedAt("contractor"),
          customerSignedAt: signedAt("customer"),
        }
      : null,
    depositPaidAt: deposit?.paidAt
      ? new Date(deposit.paidAt).toISOString()
      : null,
  };
}
