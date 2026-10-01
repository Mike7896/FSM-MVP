import "server-only";

import { and, eq } from "drizzle-orm";

import { db } from "@/lib/db";
import { documents, invoiceDetails, jobs } from "@/lib/db/schema";

import { jobSettlement } from "./settlement";

/**
 * WHERE THE JOB IS, kept in step with its money.
 *
 * A job's status is one of the few things in the hub that is stored rather than
 * derived, because a contractor may set it himself — scheduling a start date is
 * his call, not the money's. So this only ever moves a job **forward**, and only
 * on facts: the agreement is signed, the last bill has gone out, the money is
 * all in.
 *
 * Moving it backwards would overwrite something he decided with something we
 * inferred, which is how an app starts arguing with the person using it.
 */

type JobStatus = (typeof jobs.status.enumValues)[number];

/** Lifecycle order. A job never goes back up this list on its own. */
const ORDER: JobStatus[] = [
  "quoting",
  "scheduled",
  "in_progress",
  "complete",
  "paid",
];

export async function refreshJobStatus(
  jobId: string,
  organizationId: string
): Promise<JobStatus | null> {
  const [job] = await db
    .select({ status: jobs.status })
    .from(jobs)
    .where(and(eq(jobs.id, jobId), eq(jobs.organizationId, organizationId)))
    .limit(1);

  if (!job) return null;

  const reached = await earned(jobId, organizationId);
  if (!reached) return job.status;

  if (ORDER.indexOf(reached) <= ORDER.indexOf(job.status)) return job.status;

  await db
    .update(jobs)
    .set({ status: reached, updatedAt: new Date() })
    .where(and(eq(jobs.id, jobId), eq(jobs.organizationId, organizationId)));

  return reached;
}

/** The furthest point this job's documents and money can justify. */
async function earned(
  jobId: string,
  organizationId: string
): Promise<JobStatus | null> {
  const settlement = await jobSettlement(jobId, organizationId);

  // No contract: nothing has been agreed, so the job is still being quoted and
  // this has no business saying otherwise.
  if (!settlement) return null;

  // Everything agreed has arrived. Said from the ledger rather than from a
  // status somebody set, so a cheque counts exactly as a card does.
  if (settlement.agreedCents > 0 && settlement.collectedCents >= settlement.agreedCents) {
    return "paid";
  }

  const [final] = await db
    .select({ id: documents.id })
    .from(documents)
    .innerJoin(invoiceDetails, eq(invoiceDetails.documentId, documents.id))
    .where(
      and(
        eq(documents.jobId, jobId),
        eq(documents.organizationId, organizationId),
        eq(documents.type, "invoice"),
        eq(invoiceDetails.invoiceType, "final_balance")
      )
    )
    .limit(1);

  // The last bill is out: the work is done and what remains is collection.
  if (final) return "complete";

  return "in_progress";
}
