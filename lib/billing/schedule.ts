import "server-only";

import { and, asc, eq, isNull } from "drizzle-orm";

import { db } from "@/lib/db";
import { drawSchedule } from "@/lib/db/schema";
import type { Executor } from "@/lib/documents";
import type { PhaseGate } from "@/lib/schemas";

/**
 * THE PAYMENT PLAN — how a job's money is scheduled to come in.
 *
 * **A plan, not a document.** Nobody signs it and it is not the agreement: the
 * Contract is what was agreed, and this is the shop's reading of how that
 * agreement gets billed. It hangs off the Job, which is why a job planned
 * before anything is signed is a real state.
 *
 * **It has to add up to the agreement, exactly.** Deposit plus every stage
 * equals the total, so a rounding cent can never leave a job that cannot be
 * fully billed — the last stage takes whatever is left rather than its own
 * rounded share.
 *
 * **Milestones, not percentages, once it lands.** The Office keeps percentages
 * because they are a pattern with no job behind them; the moment there is a
 * price to apply them to they become dollar amounts on named stages, because a
 * milestone is observable and a percentage is an assertion.
 */

export type PlannedStage = {
  name: string;
  amountCents: number;
  gate: PhaseGate;
  /** The quote phase it was planned from, when it was. */
  phaseKey?: string | null;
};

/**
 * Writes the plan onto the job — called when a quote is accepted and the
 * agreement it reads comes into existence.
 *
 * **A plan the contractor made himself wins over a pattern** — if the job
 * already has stages, they stand and only gain the contract they now read.
 * **The schedule she agreed to wins over both**: with `replace`, unbilled
 * stages typed on the job before anything was agreed give way to the one the
 * quote showed her. Nothing billed is ever touched.
 */
export async function seedJobSchedule({
  jobId,
  contractId,
  stages,
  replace = false,
  on = db,
}: {
  jobId: string;
  contractId: string | null;
  stages: PlannedStage[];
  /** The quote showed her a schedule, so it is the plan. */
  replace?: boolean;
  on?: Executor;
}): Promise<number> {
  const existing: { id: string; invoiceId: string | null }[] = await on
    .select({ id: drawSchedule.id, invoiceId: drawSchedule.invoiceId })
    .from(drawSchedule)
    .where(eq(drawSchedule.jobId, jobId));

  if (replace && existing.length > 0 && existing.every((row) => row.invoiceId === null)) {
    await on.delete(drawSchedule).where(eq(drawSchedule.jobId, jobId));
  } else if (existing.length > 0) {
    if (contractId) {
      await on
        .update(drawSchedule)
        .set({ contractId, updatedAt: new Date() })
        .where(
          and(eq(drawSchedule.jobId, jobId), isNull(drawSchedule.contractId))
        );
    }
    return 0;
  }

  if (stages.length === 0) return 0;

  await on.insert(drawSchedule).values(
    stages.map((stage, position) => ({
      jobId,
      contractId,
      position,
      name: stage.name,
      amountCents: stage.amountCents,
      gate: stage.gate,
      phaseKey: stage.phaseKey ?? null,
    }))
  );

  return stages.length;
}

/**
 * The stage a bill of this kind belongs to, when the plan has one waiting.
 *
 * The deposit invoice issued at signing, and the final balance at the end, each
 * *become* the stage that planned them — that is what keeps the hub's "money,
 * in order" from showing the same money twice.
 */
export async function unbilledStage(
  jobId: string,
  gate: PhaseGate,
  on: Executor = db
): Promise<{ id: string; name: string; amountCents: number } | null> {
  const [stage] = await on
    .select({
      id: drawSchedule.id,
      name: drawSchedule.name,
      amountCents: drawSchedule.amountCents,
    })
    .from(drawSchedule)
    .where(
      and(
        eq(drawSchedule.jobId, jobId),
        eq(drawSchedule.gate, gate),
        isNull(drawSchedule.invoiceId)
      )
    )
    .orderBy(asc(drawSchedule.position))
    .limit(1);

  return stage ?? null;
}
