import "server-only";

import { and, eq } from "drizzle-orm";

import { db } from "@/lib/db";
import {
  contractDetails,
  customers,
  documentSends,
  documents,
  jobs,
  organizations,
} from "@/lib/db/schema";
import { contractEmail } from "@/lib/email/contract-email";
import { enclose } from "@/lib/email/enclosure";
import { letterheadFor } from "@/lib/email/letterhead";
import {
  EmailNotConfiguredError,
  emailConfigured,
  sendEmail,
} from "@/lib/email/send";
import type { SendContractInput } from "@/lib/schemas";

import { DocumentError } from "../errors";
import { ensureShareLink } from "../share-links";
import { checkSendAllowance } from "@/lib/admin/limits";

/**
 * `sendContract` — the contract goes to the customer again.
 *
 * A contract reaches its customer once already, when approving the quote hands
 * them its link. This is every time after that: they lost the email, they want
 * a copy for their records, or the contractor is chasing the signature.
 *
 * **The same link, not a new one.** `ensureShareLink` returns the live one, so
 * the copy a customer was sent last week and the copy sent today are the same
 * page — and a signature made on either is the same signature. Minting a second
 * token per send would leave two live links to one agreement, which is how
 * somebody ends up signing a document nobody is looking at.
 *
 * **Sending doesn't change the agreement.** No status moves, nothing freezes,
 * nothing is stamped: this is delivery, and the send is appended to
 * `document_sends` so there is a record of what went where. The document's own
 * `sent_at` is filled only if it never had one.
 *
 * A demo job is refused. Its contract is practice, and practice does not get
 * mailed to anybody.
 */
export type SendContractResult = {
  url: string;
  channel: SendContractInput["channel"];
  to: string | null;
};

export async function sendContract({
  organizationId,
  contractId,
  sender,
  input,
}: {
  organizationId: string;
  contractId: string;
  sender: { userId: string; email: string };
  input: SendContractInput;
}): Promise<SendContractResult> {
  // A test account may have a daily cap; everyone else passes straight through.
  await checkSendAllowance(sender.userId);

  const [row] = await db
    .select({
      id: documents.id,
      status: documents.status,
      number: documents.number,
      title: documents.title,
      header: documents.header,
      priceCents: contractDetails.contractSumCents,
      jobId: documents.jobId,
      customerId: documents.customerId,
      sentAt: documents.sentAt,
      demo: jobs.isDemo,
      customerName: customers.name,
      customerEmail: customers.email,
      businessName: organizations.name,
      replyTo: organizations.email,
    })
    .from(documents)
    .innerJoin(jobs, eq(documents.jobId, jobs.id))
    .innerJoin(customers, eq(jobs.customerId, customers.id))
    .innerJoin(organizations, eq(documents.organizationId, organizations.id))
    .leftJoin(contractDetails, eq(contractDetails.documentId, documents.id))
    .where(
      and(
        eq(documents.id, contractId),
        eq(documents.organizationId, organizationId),
        eq(documents.type, "contract")
      )
    )
    .limit(1);

  if (!row) {
    throw new DocumentError("No contract with that id.", "not_found");
  }

  if (row.demo) {
    throw new DocumentError(
      "This is a demo job. Its contract stays with you.",
      "invalid"
    );
  }

  /* ── Who it goes to ─────────────────────────────────────────────────── */

  let to: string | null = null;

  if (input.channel === "email") {
    to = input.to ?? row.customerEmail ?? null;
    if (!to) {
      throw new DocumentError(
        "Where should it go? Add their email address.",
        "invalid",
        [{ field: "to", message: "Add their email address." }]
      );
    }
    if (!emailConfigured()) {
      throw new DocumentError(new EmailNotConfiguredError().message);
    }
  }

  /* ── The link ───────────────────────────────────────────────────────── */

  // The live one, with signing on it: an unsigned contract is sent to be
  // signed, and a signed one opens on the same page with the signatures on it.
  const { url } = await ensureShareLink({ id: row.id, jobId: row.jobId }, [
    "view",
    "sign",
  ]);

  /* ── Delivery ───────────────────────────────────────────────────────── */

  const businessName = row.businessName?.trim() || null;
  const typed = input.message?.trim() || null;

  if (to) {
    try {
      // The letterhead it was agreed under, not the Office as it is today.
      const letterhead = await letterheadFor(organizationId, row.header);
      const enclosure = await enclose(row.id, organizationId, letterhead);
      const email = await contractEmail({
        letterhead,
        paper: enclosure.paper,
        attached: Boolean(enclosure.pdf),
        customerName: row.customerName,
        message: typed,
        title: row.title,
        number: row.number,
        priceCents: row.priceCents ?? 0,
        url,
        signed: row.status === "signed",
      });
      await sendEmail({
        to,
        ...email,
        replyTo: row.replyTo ?? sender.email,
        fromName: businessName,
        attachments: enclosure.pdf ? [enclosure.pdf] : [],
      });
    } catch (error) {
      if (error instanceof EmailNotConfiguredError) {
        throw new DocumentError(error.message);
      }
      // Nothing is recorded when delivery failed — a send that didn't happen
      // must not appear in the history as one that did.
      throw new DocumentError(
        `The email didn't go out. ${error instanceof Error ? error.message : ""}`.trim(),
        "failed"
      );
    }
  }

  /* ── The record ─────────────────────────────────────────────────────── */

  const now = new Date();

  await db.transaction(async (tx) => {
    // Asked once: an address typed here is kept on the customer, so the next
    // document doesn't ask again.
    if (input.to && row.customerId && input.to !== row.customerEmail) {
      await tx
        .update(customers)
        .set({ email: input.to, updatedAt: now })
        .where(eq(customers.id, row.customerId));
    }

    // A contract is frozen when it is signed, and the database allows only a
    // few columns to move after that — `sent_at` is one, and it is only ever
    // filled in, never moved.
    if (row.sentAt === null) {
      await tx
        .update(documents)
        .set({ sentAt: now, updatedAt: now })
        .where(eq(documents.id, row.id));
    }

    await tx.insert(documentSends).values({
      organizationId,
      documentId: row.id,
      channel: input.channel,
      recipient: to,
      message: typed,
      sentBy: sender.userId,
      sentAt: now,
    });
  });

  return { url, channel: input.channel, to };
}
