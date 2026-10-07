import "server-only";

import { and, eq, sql } from "drizzle-orm";

import { db } from "@/lib/db";
import { documents, invoiceDetails, jobs, drawSchedule, evidence, evidencePhotos } from "@/lib/db/schema";
import { collectedForInvoice } from "@/lib/ledger";

import { DocumentError } from "../errors";

/**
 * Withdrawing an invoice — voided, not deleted.
 *
 * An invoice that has gone out is part of the record of what was asked for.
 * Deleting it would leave payments pointing at nothing and a job's billed total
 * silently dropping, so it is voided: the status changes and the moment is
 * recorded, and the amount stays exactly as it was issued (Documents §7).
 *
 * A draft nobody has seen is genuinely disposable, so that one is removed
 * outright — its phase goes back to unbilled on its own.
 *
 * **Money that arrived can't be voided away.** A paid bill is settled by a
 * refund, which is a ledger row of its own.
 */
export async function voidInvoice({
  organizationId,
  invoiceId,
}: {
  organizationId: string;
  invoiceId: string;
}): Promise<{ outcome: "deleted" } | { outcome: "voided"; voidedAt: Date }> {
  return db.transaction(async (tx) => {
    const [owner] = await tx.select({ jobId: documents.jobId }).from(documents)
      .where(and(eq(documents.id, invoiceId), eq(documents.organizationId, organizationId))).limit(1);
    if (!owner) throw new DocumentError("No invoice with that id in this shop.", "not_found");
    // Use the same job lock as invoice creation/issuance.
    await tx.select({ id: jobs.id }).from(jobs).where(eq(jobs.id, owner.jobId)).for("update");
    await tx.select({ id: documents.id }).from(documents).where(eq(documents.id, invoiceId)).for("update");
    const [row] = await tx
      .select({
        type: documents.type,
        status: documents.status,
        voidedAt: invoiceDetails.voidedAt,
        paidCents: sql<string>`${collectedForInvoice(sql.raw('"documents"."id"'))}::text`,
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

    if (row.status === "paid" || Number(row.paidCents) > 0) {
      throw new DocumentError(
        "This invoice has money against it. Refund the payment rather than removing the bill."
      );
    }

    if (row.status === "draft") {
      await tx.delete(documents).where(eq(documents.id, invoiceId));
      return { outcome: "deleted" };
    }

    // Free the planned phase, preserving the withdrawn invoice as history.
    await tx.update(drawSchedule).set({ invoiceId: null, updatedAt: new Date() })
      .where(and(eq(drawSchedule.jobId, owner.jobId), eq(drawSchedule.invoiceId, invoiceId)));

    if (row.voidedAt) return { outcome: "voided", voidedAt: row.voidedAt };

    // Keep the withdrawn bill's proof intact, and make a copy available for its
    // replacement. The phase remains completed; no second site visit is needed.
    const proofs = await tx.select().from(evidence)
      .where(and(eq(evidence.jobId, owner.jobId), eq(evidence.invoiceId, invoiceId)));
    for (const proof of proofs) {
      const { id: originalId, ...record } = proof;
      const [replacement] = await tx.insert(evidence)
        .values({ ...record, invoiceId: null, sentAt: null, approvedAt: null }).returning({ id: evidence.id });
      const photos = await tx.select().from(evidencePhotos).where(eq(evidencePhotos.evidenceId, originalId));
      if (photos.length) {
        await tx.insert(evidencePhotos).values(photos.map(photo => ({
          evidenceId: replacement.id, fileUrl: photo.fileUrl, caption: photo.caption, position: photo.position,
        })));
      }
    }

    const now = new Date();

    await tx
      .update(invoiceDetails)
      .set({ voidedAt: now })
      .where(eq(invoiceDetails.documentId, invoiceId));
    await tx
      .update(documents)
      .set({ status: "void", updatedAt: now })
      .where(eq(documents.id, invoiceId));

    return { outcome: "voided", voidedAt: now };
  });
}
