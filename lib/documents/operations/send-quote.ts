import "server-only";

import { and, asc, eq } from "drizzle-orm";

import { db } from "@/lib/db";
import {
  customers,
  documentSends,
  documents,
  jobs,
  licenses,
  organizations,
  quoteDetails,
} from "@/lib/db/schema";
import { enclose } from "@/lib/email/enclosure";
import { letterheadFor } from "@/lib/email/letterhead";
import { quoteEmail, quoteMessage } from "@/lib/email/quote-email";
import {
  EmailNotConfiguredError,
  emailConfigured,
  sendEmail,
} from "@/lib/email/send";
import { getOfficeSignature } from "@/lib/queries/office";
import { draftFromRecord, totals } from "@/lib/quote";
import type { SendQuoteInput } from "@/lib/schemas";
import { signsOnQuote } from "@/lib/signing/lines";

import { DocumentError } from "../errors";
import { captureHeader } from "../header";
import { readQuoteRecord } from "../quote-record";
import { ensureShareLink } from "../share-links";
import { checkSendAllowance } from "@/lib/admin/limits";
import { withDocumentActivation } from "@/lib/membership/activation";

/**
 * `sendQuote` — the quote goes out.
 *
 * A business name is required. Licenses are optional and are captured on the
 * document only when one has been selected or is available in the Office.
 *
 * **Email is the way out.** `email` delivers his message, the quote's card and
 * its link through Resend, from the business's name with replies going to the
 * business. `link` is the fallback — it records the send and hands the link
 * back for him to pass on himself. There is no texting from the product: SMS
 * waits on a provider cheap enough to put behind every quote.
 *
 * **A demo goes to him and nowhere else.** There is no recipient to choose: an
 * email goes to his own sign-in address, and anything else is refused.
 *
 * **What goes out is frozen onto the document.** The letterhead is captured at
 * the send (Documents §2), and every send is appended to `document_sends` — the
 * record of what went where survives a resend, a changed address and a moved
 * shop.
 */

export type SendQuoteResult = {
  url: string;
  sentAt: string;
  channel: SendQuoteInput["channel"];
  to: string | null;
};

/**
 * The send, with its Free-plan activation around it (Billing §3.1): the job's
 * slot is reserved before anything goes out, committed once it has, and
 * released if the send fails. A job already activated costs nothing.
 */
export async function sendQuote(
  args: Parameters<typeof sendQuoteNow>[0]
): Promise<SendQuoteResult> {
  return withDocumentActivation(
    {
      organizationId: args.organizationId,
      documentId: args.quoteId,
      action: "quote_sent",
      actorUserId: args.sender.userId,
    },
    () => sendQuoteNow(args)
  );
}

async function sendQuoteNow({
  organizationId,
  quoteId,
  sender,
  input,
}: {
  organizationId: string;
  quoteId: string;
  /** Who pressed Send — and, on a demo, where it goes. */
  sender: { userId: string; email: string };
  input: SendQuoteInput;
}): Promise<SendQuoteResult> {
  // A test account may have a daily cap; everyone else passes straight through.
  await checkSendAllowance(sender.userId);

  const [row] = await db
    .select({
      id: documents.id,
      type: documents.type,
      jobId: documents.jobId,
      status: documents.status,
      sentAt: documents.sentAt,
      frozenAt: documents.frozenAt,
      customerId: documents.customerId,
      licenseId: quoteDetails.licenseId,
      demo: jobs.isDemo,
      customerName: customers.name,
      customerEmail: customers.email,
    })
    .from(documents)
    .innerJoin(jobs, eq(documents.jobId, jobs.id))
    .leftJoin(quoteDetails, eq(quoteDetails.documentId, documents.id))
    .leftJoin(customers, eq(documents.customerId, customers.id))
    .where(
      and(eq(documents.id, quoteId), eq(documents.organizationId, organizationId))
    )
    .limit(1);

  if (!row || row.type !== "quote") {
    throw new DocumentError("No quote with that id.", "not_found");
  }

  /* ── The gate ───────────────────────────────────────────────────────── */

  const [[office], [license]] = await Promise.all([
    db
      .select({ name: organizations.name, email: organizations.email })
      .from(organizations)
      .where(eq(organizations.id, organizationId))
      .limit(1),
    db
      .select({ id: licenses.id })
      .from(licenses)
      .where(
        and(
          eq(licenses.organizationId, organizationId),
          eq(licenses.status, "active")
        )
      )
      .orderBy(asc(licenses.createdAt))
      .limit(1),
  ]);

  const businessName = office?.name?.trim() || null;
  if (!businessName) {
    const message = "Add your business name before sending the quote.";
    throw new DocumentError(message, "invalid", [{ field: "header", message }]);
  }

  /* ── Who it goes to ─────────────────────────────────────────────────── */

  let to: string | null = null;

  if (row.demo) {
    if (input.to && input.to.toLowerCase() !== sender.email.toLowerCase()) {
      const message = "A demo goes to you and nowhere else.";
      throw new DocumentError(message, "invalid", [{ field: "to", message }]);
    }
    if (input.channel === "email") to = sender.email;
  } else if (input.channel === "email") {
    to = input.to ?? row.customerEmail ?? null;
    if (!to) {
      throw new DocumentError(
        "Where should it go? Add their email address.",
        "invalid",
        [{ field: "to", message: "Add their email address." }]
      );
    }
  }

  if (to && !emailConfigured()) {
    throw new DocumentError(new EmailNotConfiguredError().message);
  }

  /* ── The link ───────────────────────────────────────────────────────── */

  // Minted before anything is delivered: the link has to open by the time the
  // email lands.
  // A real quote's link lets its holder approve it (Flow 2). A demo's never
  // does: it went to the contractor, and nothing on it is ever agreed.
  const { url } = await ensureShareLink(
    { id: row.id, jobId: row.jobId },
    row.demo ? ["view"] : ["view", "accept"]
  );

  // The words that went, for the record below — the email's, once it has been
  // composed.
  let message: string | null = input.message?.trim() || null;

  /* ── Delivery ───────────────────────────────────────────────────────── */

  const typed = input.message?.trim() || null;

  if (to) {
    try {
      const email = await composeQuoteEmail({
        organizationId,
        quoteId,
        message: typed,
        subject: input.subject ?? null,
        url,
        demo: row.demo,
        attach: true,
      });
      await sendEmail({
        to,
        subject: email.subject,
        html: email.html,
        text: email.text,
        replyTo: office?.email ?? sender.email,
        fromName: businessName,
        attachments: email.attachments,
      });
      message = email.message;
    } catch (error) {
      if (error instanceof EmailNotConfiguredError) {
        throw new DocumentError(error.message);
      }
      // Nothing is marked sent when delivery failed: the quote stays exactly
      // where it was, and the sheet keeps what he typed.
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
    // Asked once: the address he typed is kept on the customer — before the
    // letterhead is captured, so it's on the document too.
    if (
      !row.demo &&
      input.to &&
      row.customerId &&
      input.to !== row.customerEmail
    ) {
      await tx
        .update(customers)
        .set({ email: input.to, updatedAt: now })
        .where(eq(customers.id, row.customerId));
    }

    // An accepted quote is frozen. Sending it again is still a send worth
    // recording, but what it says was settled the day it was agreed.
    if (row.frozenAt === null) {
      const licenseId = row.licenseId ?? license?.id ?? null;

      await tx
        .update(documents)
        .set({
          // Only a draft becomes sent. Sending an opened quote again must not
          // move it backwards.
          status: row.status === "draft" ? "sent" : row.status,
          sentAt,
          header: await captureHeader(
            {
              organizationId,
              jobId: row.jobId,
              customerId: row.customerId,
              licenseId,
            },
            tx
          ),
          updatedAt: now,
        })
        .where(eq(documents.id, row.id));

      if (!row.licenseId && licenseId) {
        // The license it goes out stamped with. Later changes to the vault
        // don't reach a document already in someone's hands.
        await tx
          .update(quoteDetails)
          .set({ licenseId })
          .where(eq(quoteDetails.documentId, row.id));
      }
    }

    await tx.insert(documentSends).values({
      organizationId,
      documentId: row.id,
      channel: input.channel,
      recipient: to,
      // The words that actually went: his for a copied link, and whatever the
      // email carried when it went through us.
      message,
      sentBy: sender.userId,
      sentAt: now,
    });
  });

  return {
    url,
    sentAt: sentAt.toISOString(),
    channel: input.channel,
    to,
  };
}

/**
 * The email a quote goes out in, composed from the quote as it stands.
 *
 * **One composer for the send and its preview.** The send sheet shows the
 * contractor this exact email before it goes, so the preview and the delivery
 * are the same function — a preview drawn separately is a preview that drifts.
 *
 * `url` is null when previewing a quote that has never gone out: its link is
 * minted by the send, not by looking.
 */
export async function composeQuoteEmail({
  organizationId,
  quoteId,
  message,
  subject,
  url,
  demo,
  attach = false,
}: {
  organizationId: string;
  quoteId: string;
  /** What he typed. Null or blank, the quote's own opening is used. */
  message: string | null;
  subject: string | null;
  url: string | null;
  /** Read from the job when left out. */
  demo?: boolean;
  /**
   * Render the PDF to attach. Off for the send sheet's preview, which shows
   * the page but sends nothing.
   */
  attach?: boolean;
}) {
  const [record, [details], [job], stored, letterhead] = await Promise.all([
    readQuoteRecord(quoteId, organizationId),
    db
      .select({ validUntil: quoteDetails.validUntil })
      .from(quoteDetails)
      .where(eq(quoteDetails.documentId, quoteId))
      .limit(1),
    db
      .select({ demo: jobs.isDemo })
      .from(documents)
      .innerJoin(jobs, eq(documents.jobId, jobs.id))
      .where(eq(documents.id, quoteId))
      .limit(1),
    getOfficeSignature(organizationId),
    letterheadFor(organizationId),
  ]);

  if (!record) {
    throw new DocumentError("No quote with that id.", "not_found");
  }

  const draft = draftFromRecord(record);
  const sums = totals(draft);
  const isDemo = demo ?? job?.demo ?? false;
  const words =
    message?.trim() || quoteMessage(record.customerName, record.title, isDemo);

  // The quote drawn as its page for the email's body — and, when it's really
  // going, the same page as a PDF.
  const enclosure = await enclose(quoteId, organizationId, letterhead, {
    pdf: attach,
  });

  const email = await quoteEmail({
    paper: enclosure.paper,
    attached: Boolean(enclosure.pdf),
    letterhead,
    customerName: record.customerName,
    message: words,
    subject,
    title: record.title,
    number: record.number,
    totalCents: sums.totalCents,
    depositCents: sums.depositCents,
    validUntil: details?.validUntil ?? null,
    signs: !isDemo && signsOnQuote(draft, stored),
    url,
    demo: isDemo,
  });

  return {
    ...email,
    message: words,
    fromName: letterhead.name,
    attachments: enclosure.pdf ? [enclosure.pdf] : [],
  };
}
