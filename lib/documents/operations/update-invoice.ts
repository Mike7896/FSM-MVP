import "server-only";

import { and, eq } from "drizzle-orm";

import { db } from "@/lib/db";
import { documents, invoiceDetails, jobs } from "@/lib/db/schema";
import type { UpdateInvoiceInput } from "@/lib/schemas";

import { jobMoney } from "@/lib/queries/jobs";
import type { Executor } from "../repository";
import { captureHeader } from "../header";
import { DocumentError } from "../errors";

/**
 * Editing an invoice.
 *
 * **What she was asked to pay only moves while it's a draft.** Once an invoice
 * has gone out, the number on her screen is the number she owes — changing it
 * underneath her is how a dispute starts, and the model already has the right
 * answer for a different amount: void this one and issue another, or raise a
 * change order. The freeze trigger enforces it; this says so first.
 *
 * Two things do move afterwards, because they are about what happened rather
 * than what was billed: whether the milestone a draw depends on has been met,
 * and the issue itself.
 */
export async function updateInvoice({
  organizationId,
  invoiceId,
  input,
  on = db,
}: {
  organizationId: string;
  invoiceId: string;
  input: UpdateInvoiceInput;
  on?: Executor;
}): Promise<{ id: string; number: string; status: typeof documents.$inferSelect.status; issuedAt: Date | null; amountDueCents: number; covers: string | null; dueOn: string | null; gateMetAt: Date | null }> {
  if (on === db) return db.transaction(tx => updateInvoice({ organizationId, invoiceId, input, on: tx }));
  const [row] = await on
    .select({
      status: documents.status,
      jobId: documents.jobId,
      customerId: documents.customerId,
      amountDueCents: invoiceDetails.amountDueCents,
      type: documents.type,
      voidedAt: invoiceDetails.voidedAt,
      gateMetAt: invoiceDetails.gateMetAt,
    })
    .from(documents)
    .innerJoin(invoiceDetails, eq(invoiceDetails.documentId, documents.id))
    .where(
      and(
        eq(documents.id, invoiceId),
        eq(documents.organizationId, organizationId)
      )
    )
    .limit(1);

  if (!row || row.type !== "invoice") {
    throw new DocumentError("No invoice with that id in this shop.", "not_found");
  }

  if (row.status === "void" || row.voidedAt) {
    throw new DocumentError("This invoice has been voided.");
  }

  await on.select({ id: jobs.id }).from(jobs).where(eq(jobs.id, row.jobId)).for("update");
  const [current] = await on.select({ status: documents.status, amountDueCents: invoiceDetails.amountDueCents, gateMetAt: invoiceDetails.gateMetAt }).from(documents).innerJoin(invoiceDetails, eq(invoiceDetails.documentId, documents.id)).where(eq(documents.id, invoiceId)).for("update");
  if (current.status !== row.status) throw new DocumentError("This invoice changed. Reload before continuing.");
  row.amountDueCents = current.amountDueCents;
  row.gateMetAt = current.gateMetAt;
  if (input.issue && row.status === "draft") {
    const [agreement] = await on.select({ id: documents.id }).from(documents).where(and(eq(documents.jobId, row.jobId), eq(documents.type, "contract"))).limit(1);
    const money = (await jobMoney([row.jobId], on)).get(row.jobId);
    if (agreement && money && money.billedCents + (input.amountDueCents ?? row.amountDueCents) > money.totalCents) throw new DocumentError("This invoice would exceed the current agreement. Review approved changes and existing invoices before issuing it.", "invalid");
  }
  const draft = row.status === "draft";
  const touchesAmount =
    input.amountDueCents !== undefined ||
    input.covers !== undefined ||
    input.dueOn !== undefined;

  if (touchesAmount && !draft) {
    throw new DocumentError(
      "This invoice has already gone out. Void it and issue a new one rather than changing what she was asked to pay."
    );
  }

  const now = new Date();

  await on.transaction(async (tx: Executor) => {
    const details: Partial<typeof invoiceDetails.$inferInsert> = {};
    if (input.amountDueCents !== undefined) {
      details.amountDueCents = input.amountDueCents;
    }
    if (input.covers !== undefined) details.covers = input.covers;
    if (input.dueOn !== undefined) details.dueOn = input.dueOn;
    if (input.gateMet !== undefined) {
      // The first moment it was met is the one that counts; clearing it is a
      // correction, not a second event.
      details.gateMetAt = input.gateMet ? (row.gateMetAt ?? now) : null;
    }

    if (Object.keys(details).length) {
      await tx
        .update(invoiceDetails)
        .set(details)
        .where(eq(invoiceDetails.documentId, invoiceId));
    }

    if (input.issue && draft) {
      // Issuing is a real moment, stamped rather than inferred later — and it
      // is the update that freezes the invoice.
      await tx
        .update(documents)
        .set({ status: "issued", issuedAt: now, updatedAt: now, header: await captureHeader({ organizationId, jobId: row.jobId, customerId: row.customerId, licenseId: null }, tx) })
        .where(eq(documents.id, invoiceId));
    }
  });

  const [updated] = await on
    .select({
      id: documents.id,
      number: documents.number,
      status: documents.status,
      issuedAt: documents.issuedAt,
      amountDueCents: invoiceDetails.amountDueCents,
      covers: invoiceDetails.covers,
      dueOn: invoiceDetails.dueOn,
      gateMetAt: invoiceDetails.gateMetAt,
    })
    .from(documents)
    .innerJoin(invoiceDetails, eq(invoiceDetails.documentId, documents.id))
    .where(eq(documents.id, invoiceId))
    .limit(1);

  return updated;
}
