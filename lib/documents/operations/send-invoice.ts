import "server-only";

import { and, eq } from "drizzle-orm";

import { db } from "@/lib/db";
import {
  customers,
  documentSends,
  documents,
  invoiceDetails,
  jobs,
  organizations,
} from "@/lib/db/schema";
import { invoiceEmail } from "@/lib/email/invoice-email";
import { enclose } from "@/lib/email/enclosure";
import { letterheadFor } from "@/lib/email/letterhead";
import {
  EmailNotConfiguredError,
  emailConfigured,
  sendEmail,
} from "@/lib/email/send";
import { formatMoney } from "@/lib/quote/money";
import type { SendInvoiceInput } from "@/lib/schemas";

import { DocumentError } from "../errors";
import { captureHeader, headerCaptured } from "../header";
import { ensureShareLink } from "../share-links";
import { checkSendAllowance } from "@/lib/admin/limits";
import { withDocumentActivation } from "@/lib/membership/activation";

/**
 * `sendInvoice` — the bill goes out.
 *
 * The same two ways out as a quote: **email** delivers the contractor's message
 * with the link under it, and **link** hands the link back for the texts he
 * already sends himself. The link is never optional — it is how she pays.
 *
 * **What goes out is frozen onto the document.** The letterhead is captured at
 * the first send, and every send is appended to `document_sends`, so the record
 * of what went where survives a resend and a changed address.
 *
 * A demo is refused outright: money on a practice job is not money, and a link
 * that cannot be paid is not a bill.
 */
export type SendInvoiceResult = {
  url: string;
  sentAt: string;
  channel: SendInvoiceInput["channel"];
  to: string | null;
};

/**
 * The send, with its Free-plan activation around it (Billing §3.1): the job's
 * slot is reserved before anything goes out, committed once it has, and
 * released if the send fails. A job already activated costs nothing.
 */
export async function sendInvoice(
  args: Parameters<typeof sendInvoiceNow>[0]
): Promise<SendInvoiceResult> {
  return withDocumentActivation(
    {
      organizationId: args.organizationId,
      documentId: args.invoiceId,
      action: "invoice_sent",
      actorUserId: args.sender.userId,
    },
    () => sendInvoiceNow(args)
  );
}

async function sendInvoiceNow({
  organizationId,
  invoiceId,
  sender,
  input,
}: {
  organizationId: string;
  invoiceId: string;
  sender: { userId: string; email: string };
  input: SendInvoiceInput;
}): Promise<SendInvoiceResult> {
  // A test account may have a daily cap; everyone else passes straight through.
  await checkSendAllowance(sender.userId);

  const [row] = await db
    .select({
      id: documents.id,
      type: documents.type,
      status: documents.status,
      number: documents.number,
      jobId: documents.jobId,
      customerId: documents.customerId,
      header: documents.header,
      frozenAt: documents.frozenAt,
      sentAt: documents.sentAt,
      invoiceType: invoiceDetails.invoiceType,
      amountDueCents: invoiceDetails.amountDueCents,
      dueOn: invoiceDetails.dueOn,
      covers: invoiceDetails.covers,
      voidedAt: invoiceDetails.voidedAt,
      jobName: jobs.name,
      demo: jobs.isDemo,
      customerName: customers.name,
      customerEmail: customers.email,
      businessName: organizations.name,
      replyTo: organizations.email,
    })
    .from(documents)
    .innerJoin(invoiceDetails, eq(invoiceDetails.documentId, documents.id))
    .innerJoin(jobs, eq(documents.jobId, jobs.id))
    .innerJoin(customers, eq(jobs.customerId, customers.id))
    .innerJoin(organizations, eq(documents.organizationId, organizations.id))
    .where(
      and(
        eq(documents.id, invoiceId),
        eq(documents.organizationId, organizationId),
        eq(documents.type, "invoice")
      )
    )
    .limit(1);

  if (!row) {
    throw new DocumentError("No invoice with that id.", "not_found");
  }

  if (row.demo) {
    throw new DocumentError(
      "This is a demo job. Nothing on it can be billed or paid.",
      "invalid"
    );
  }

  if (row.status === "draft") {
    throw new DocumentError(
      `${row.number} is still a draft. Issue it first — a bill she can pay has to be a real one.`
    );
  }

  if (row.voidedAt || row.status === "void") {
    throw new DocumentError(
      `${row.number} was withdrawn, so there's nothing to send.`
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

  // Minted before anything is delivered: the link has to open — and take a
  // payment — by the time the email lands.
  const { url } = await ensureShareLink({ id: row.id, jobId: row.jobId }, [
    "view",
    "pay",
  ]);

  /* ── Delivery ───────────────────────────────────────────────────────── */

  const businessName = row.businessName?.trim() || null;
  const work = row.covers?.trim() || row.jobName?.trim() || null;
  const typed = input.message?.trim() || null;

  if (to) {
    try {
      const letterhead = await letterheadFor(organizationId, row.header);
      const enclosure = await enclose(row.id, organizationId, letterhead);
      await sendEmail({
        to,
        attachments: enclosure.pdf ? [enclosure.pdf] : [],
        ...(await invoiceEmail({
          letterhead,
          paper: enclosure.paper,
          attached: Boolean(enclosure.pdf),
          customerName: row.customerName,
          invoiceType: row.invoiceType,
          number: row.number,
          amountLabel: formatMoney(row.amountDueCents),
          work,
          dueOn: row.dueOn,
          message: typed,
          url,
        })),
        replyTo: row.replyTo ?? sender.email,
        fromName: businessName,
      });
    } catch (error) {
      if (error instanceof EmailNotConfiguredError) {
        throw new DocumentError(error.message);
      }
      // Nothing is marked sent when delivery failed: the invoice stays exactly
      // where it was.
      throw new DocumentError(
        `The email didn't go out. ${error instanceof Error ? error.message : ""}`.trim(),
        "failed"
      );
    }
  }

  /* ── The record ─────────────────────────────────────────────────────── */

  const now = new Date();
  const sentAt = row.sentAt ?? now;

  await db.transaction(async (tx) => {
    // Asked once: the address he typed is kept on the customer.
    if (input.to && row.customerId && input.to !== row.customerEmail) {
      await tx
        .update(customers)
        .set({ email: input.to, updatedAt: now })
        .where(eq(customers.id, row.customerId));
    }

    await tx
      .update(documents)
      .set({
        // Only an issued bill becomes sent. One she has already opened must
        // not move backwards.
        status: row.status === "issued" ? "sent" : row.status,
        sentAt,
        // **A frozen bill keeps the letterhead it was issued with.** Issuing
        // freezes it, and from then on the database allows only status,
        // sent_at and viewed_at to move — so the header is captured at issue,
        // and this only fills one in for a bill written before that was true.
        ...(row.frozenAt === null && !headerCaptured(row.header)
          ? {
              header: await captureHeader(
                {
                  organizationId,
                  jobId: row.jobId,
                  customerId: row.customerId,
                  licenseId: null,
                },
                tx
              ),
            }
          : {}),
        updatedAt: now,
      })
      .where(eq(documents.id, row.id));

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

  return { url, sentAt: sentAt.toISOString(), channel: input.channel, to };
}
