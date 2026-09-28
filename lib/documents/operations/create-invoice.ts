import "server-only";

import { and, desc, eq, inArray, isNull, or, sql } from "drizzle-orm";

import { db } from "@/lib/db";
import {
  documents,
  drawSchedule,
  evidence,
  invoiceDetails,
  jobs,
} from "@/lib/db/schema";
import { jobMoney } from "@/lib/queries/jobs";
import { formatMoney } from "@/lib/quote";
import type { CreateInvoiceInput } from "@/lib/schemas";

import { DocumentError } from "../errors";
import { captureHeader } from "../header";
import type { Executor } from "../repository";

/**
 * `createInvoice` — billing, as one object with three moments.
 *
 * A deposit, a draw and a final balance are the same Invoice at different
 * points, which is what makes "pay it the same way you approved the quote"
 * structurally true rather than three near-identical flows.
 *
 * **Invoices bill an agreement, never a Quote.** Once a quote is accepted the
 * contract is the agreed document, and billing against a superseded quote is how
 * an approved change order gets silently dropped from a bill. A named source has
 * to be this job's contract or change order.
 *
 * **A job can't be billed past what was agreed.** With a contract on the job,
 * everything billed may not add up to more than its sum plus approved change
 * orders — the overflow is a change order, not a bigger invoice.
 *
 * **Issuing freezes it** (Documents §7). An issued invoice is a record of what
 * she was asked to pay; the amount can't move afterwards, and the only way to
 * withdraw one is to void it.
 *
 * The spec's `issueDepositInvoice` and `issueDrawInvoice` are the two callers
 * this will split into once acceptance issues the deposit by itself (Flow 2).
 */

export type CreatedInvoice = {
  id: string;
  number: string;
  jobId: string;
  status: "draft" | "issued";
  type: CreateInvoiceInput["type"];
  amountDueCents: number;
  covers: string | null;
  dueOn: string | null;
  issuedAt: Date | null;
};

export async function createInvoice({
  organizationId,
  input,
  on = db,
}: {
  organizationId: string;
  input: CreateInvoiceInput;
  /**
   * A transaction to run inside. `issueDepositInvoice` holds a lock across its
   * look-up and this write, and a read sent back to the pool from inside that
   * lock would wait on the very connection the lock is holding.
   */
  on?: Executor;
}): Promise<CreatedInvoice> {
  if (on === db) return db.transaction(tx => createInvoice({ organizationId, input, on: tx }));
  const [job] = await on
    .select({ id: jobs.id, customerId: jobs.customerId })
    .from(jobs)
    .where(and(eq(jobs.id, input.jobId), eq(jobs.organizationId, organizationId)))
    .limit(1)
    .for("update");

  if (!job) {
    throw new DocumentError("No job with that id in this shop.", "not_found");
  }

  /* ── What it bills ──────────────────────────────────────────────────── */

  const named = input.sourceChangeOrderId ?? input.sourceContractId;

  if (named) {
    const [source] = await on
      .select({ id: documents.id, type: documents.type, status: documents.status })
      .from(documents)
      .where(
        and(
          eq(documents.id, named),
          eq(documents.jobId, input.jobId),
          inArray(documents.type, ["contract", "change_order"])
        )
      )
      .limit(1);

    if (!source) {
      throw new DocumentError(
        "That agreement isn't on this job. An invoice bills the agreement for the work it belongs to.",
        "invalid"
      );
    }
    if (source.type === "change_order" && source.status !== "approved") {
      throw new DocumentError("The customer must approve this change order before it can be billed.", "invalid");
    }
  }

  /**
   * Billing a planned phase. The phase *becomes* this invoice rather than being
   * copied onto it, so it has to be on this job and not billed already — a phase
   * billed twice is the customer asked to pay for it twice.
   */
  let phase:
    | { id: string; name: string; invoiceId: string | null; contractId: string | null }
    | undefined;

  if (input.drawScheduleId) {
    [phase] = await on
      .select({
        id: drawSchedule.id,
        name: drawSchedule.name,
        invoiceId: drawSchedule.invoiceId,
        contractId: drawSchedule.contractId,
      })
      .from(drawSchedule)
      .where(
        and(
          eq(drawSchedule.id, input.drawScheduleId),
          eq(drawSchedule.jobId, input.jobId)
        )
      )
      .limit(1);

    if (!phase) {
      throw new DocumentError("That phase isn't on this job.", "invalid");
    }
    if (phase.invoiceId) {
      throw new DocumentError(
        `${phase.name} is already billed. Open that invoice rather than sending a second one.`
      );
    }
  }

  const [agreement] = await on
    .select({ id: documents.id })
    .from(documents)
    .where(and(eq(documents.jobId, input.jobId), eq(documents.type, "contract")))
    .orderBy(desc(documents.createdAt))
    .limit(1);

  // A phase planned before the contract was signed still bills the contract the
  // job has now.
  const sourceDocumentId =
    named ?? (phase ? (phase.contractId ?? agreement?.id ?? null) : null);

  // Only a contract is an agreement. Before one, the quote's total is still a
  // proposal, and there is nothing a change order could amend.
  if (agreement) {
    const money = (await jobMoney([input.jobId], on)).get(input.jobId);
    const billedCents = (money?.billedCents ?? 0) + input.amountDueCents;
    if (money && billedCents > money.totalCents) {
      throw new DocumentError(
        `That would bill ${formatMoney(billedCents - money.totalCents)} more than the ${formatMoney(money.totalCents)} agreed. Anything over the agreement needs a change order first.`,
        "invalid"
      );
    }
  }

  /* ── The write ──────────────────────────────────────────────────────── */

  // A savepoint when `on` is already a transaction.
  return on.transaction(async (tx: Executor) => {
    const now = new Date();

    // Written as a draft first, even when it's being issued: the freeze is
    // stamped by the status *changing* to issued, and the details have to be in
    // before it does.
    const [document] = await tx
      .insert(documents)
      .values({
        organizationId,
        jobId: input.jobId,
        customerId: job.customerId,
        type: "invoice",
        number: "",
        status: "draft",
        sourceDocumentId,
        title: input.covers ?? null,
      })
      .returning({ id: documents.id, number: documents.number });

    await tx.insert(invoiceDetails).values({
      documentId: document.id,
      invoiceType: input.type,
      amountDueCents: input.amountDueCents,
      dueOn: input.dueOn ?? null,
      covers: input.covers ?? null,
    });

    if (input.issue) {
      // The letterhead is frozen onto the bill **here**, in the same statement
      // that issues it: issuing is what freezes the document, and afterwards
      // only status, sent_at and viewed_at may move. A bill that captured its
      // header at send time could never capture one at all.
      await tx
        .update(documents)
        .set({
          status: "issued",
          issuedAt: now,
          header: await captureHeader(
            {
              organizationId,
              jobId: input.jobId,
              customerId: job.customerId,
              licenseId: null,
            },
            tx
          ),
          updatedAt: now,
        })
        .where(eq(documents.id, document.id));
    }

    // Checked again inside the write: two taps on "Bill" must not bill the
    // phase twice, and the read above can't see the other tap.
    if (phase) {
      const linked = await tx
        .update(drawSchedule)
        .set({ invoiceId: document.id, updatedAt: now })
        .where(and(eq(drawSchedule.id, phase.id), isNull(drawSchedule.invoiceId)))
        .returning({ id: drawSchedule.id });

      if (linked.length === 0) {
        throw new DocumentError(
          `${phase.name} was just billed. Open the job to see that invoice.`
        );
      }
    }

    // Attaching the evidence is what turns a draw from a bare ask into an
    // expected one — the photos of the finished phase travel with the bill.
    if (input.evidenceId) {
      const updated = await tx
        .update(evidence)
        .set({ invoiceId: document.id })
        .where(
          and(
            eq(evidence.id, input.evidenceId),
            eq(evidence.jobId, input.jobId),
            isNull(evidence.invoiceId)
          )
        )
        .returning({ id: evidence.id });

      if (updated.length === 0) {
        throw new DocumentError(
          "That evidence isn't on this job, or it has already been billed."
        );
      }
    } else if (phase) {
      // No proof named: the phase's own, if it was marked complete. Evidence
      // from before phases had ids is matched by name.
      const [proof] = await tx
        .select({ id: evidence.id })
        .from(evidence)
        .where(
          and(
            eq(evidence.jobId, input.jobId),
            isNull(evidence.invoiceId),
            or(
              eq(evidence.drawScheduleId, phase.id),
              and(
                isNull(evidence.drawScheduleId),
                sql`lower(trim(${evidence.phaseName})) = ${phase.name.trim().toLowerCase()}`
              )
            )
          )
        )
        .orderBy(desc(evidence.createdAt))
        .limit(1);

      if (proof) {
        await tx
          .update(evidence)
          .set({ invoiceId: document.id })
          .where(eq(evidence.id, proof.id));
      }
    }

    return {
      id: document.id,
      number: document.number,
      jobId: input.jobId,
      status: input.issue ? "issued" : "draft",
      type: input.type,
      amountDueCents: input.amountDueCents,
      covers: input.covers ?? null,
      dueOn: input.dueOn ?? null,
      issuedAt: input.issue ? now : null,
    };
  });
}
