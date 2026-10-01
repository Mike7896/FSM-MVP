import "server-only";

import { and, desc, eq, isNull } from "drizzle-orm";

import { refreshJobStatus } from "@/lib/billing";
import { db } from "@/lib/db";
import { documents, drawSchedule, evidence, inspections, jobs } from "@/lib/db/schema";
import { passedInspectionPhases } from "@/lib/field/inspection-gates";

import { DocumentError } from "../errors";
import { ensureShareLink } from "../share-links";
import { createInvoice } from "./create-invoice";

/**
 * `issueDrawInvoice` — Documents §8, operation 3.
 *
 * **A draw is released by something happening, never by a date.** The phase
 * finished and was photographed, or the inspector signed off. So the gate is
 * checked here rather than trusted from the page that pressed the button, and a
 * phase whose gate has not opened is refused with the reason.
 *
 * **The proof travels with the ask.** `createInvoice` attaches the phase's
 * evidence to the bill, which is what makes a mid-job money request land as
 * expected rather than alarming — the residential substitute for an architect's
 * certificate.
 *
 * The bill gets a link that can pay it, and the job moves to in-progress. What
 * it does *not* do is send: that is the contractor's call and his words, the
 * same as a quote.
 */
export async function issueDrawInvoice({
  organizationId,
  jobId,
  phaseId,
  dueOn,
}: {
  organizationId: string;
  jobId: string;
  phaseId: string;
  dueOn?: string;
}): Promise<{ invoiceId: string; number: string; url: string }> {
  const [row] = await db
    .select({
      id: drawSchedule.id,
      name: drawSchedule.name,
      amountCents: drawSchedule.amountCents,
      gate: drawSchedule.gate,
      invoiceId: drawSchedule.invoiceId,
    })
    .from(drawSchedule)
    .innerJoin(jobs, eq(drawSchedule.jobId, jobs.id))
    .where(
      and(
        eq(drawSchedule.id, phaseId),
        eq(drawSchedule.jobId, jobId),
        eq(jobs.organizationId, organizationId)
      )
    )
    .limit(1);

  if (!row) {
    throw new DocumentError("That phase isn't on this job.", "not_found");
  }

  if (row.invoiceId) {
    throw new DocumentError(
      `${row.name} is already billed. Open that invoice rather than sending a second one.`
    );
  }

  if (row.gate === "on_acceptance") {
    throw new DocumentError(
      "A deposit is issued when the contract is signed, not billed as a phase.",
      "invalid"
    );
  }

  if (row.gate === "on_completion") {
    throw new DocumentError(
      "The balance at the end is the final invoice — it carries the whole settlement.",
      "invalid"
    );
  }

  if (row.amountCents <= 0) {
    throw new DocumentError(
      `${row.name} has no amount on it. Set what it's worth on the job's plan first.`,
      "invalid"
    );
  }

  /* ── The gate ───────────────────────────────────────────────────────── */

  const [proof] = await db
    .select({ id: evidence.id })
    .from(evidence)
    .where(
      and(eq(evidence.drawScheduleId, row.id), isNull(evidence.invoiceId))
    )
    .orderBy(desc(evidence.createdAt))
    .limit(1);

  if (row.gate === "inspection_passed") {
    const results = await db
      .select({ clearsPhase: inspections.clearsPhase, result: inspections.result })
      .from(inspections)
      .where(eq(inspections.jobId, jobId))
      .orderBy(desc(inspections.createdAt));

    if (!passedInspectionPhases(results).has(row.name.trim().toLowerCase())) {
      throw new DocumentError(
        `${row.name} is billed when its inspection passes. Record the result first.`
      );
    }
  } else if (!proof) {
    throw new DocumentError(
      `Mark ${row.name} complete first — the photos and the write-up are what the bill goes out with.`
    );
  }

  /* ── The bill ───────────────────────────────────────────────────────── */

  const [contract] = await db
    .select({ id: documents.id })
    .from(documents)
    .where(and(eq(documents.jobId, jobId), eq(documents.type, "contract")))
    .orderBy(desc(documents.createdAt))
    .limit(1);

  // `createInvoice` holds the over-billing guard and links the phase and its
  // evidence to the bill in the same transaction.
  const invoice = await createInvoice({
    organizationId,
    input: {
      jobId,
      type: "draw",
      amountDueCents: row.amountCents,
      covers: row.name,
      sourceContractId: contract?.id,
      drawScheduleId: row.id,
      dueOn,
      issue: true,
    },
  });

  const { url } = await ensureShareLink({ id: invoice.id, jobId }, [
    "view",
    "pay",
  ]);

  await refreshJobStatus(jobId, organizationId);

  return { invoiceId: invoice.id, number: invoice.number, url };
}
