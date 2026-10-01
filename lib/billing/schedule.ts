import "server-only";

import { and, asc, eq, isNull } from "drizzle-orm";

import { db } from "@/lib/db";
import { drawSchedule } from "@/lib/db/schema";
import type { Executor } from "@/lib/documents";
import { percentOf } from "@/lib/quote/money";
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

/** A stage of the Office's pattern — a name and its share, with no job behind it. */
export type DrawPatternStage = { name: string; percent: number };

export type PlannedStage = {
  name: string;
  amountCents: number;
  gate: PhaseGate;
};

/**
 * The plan a job's terms imply.
 *
 * The deposit comes first and the stages split what is left, so the shape holds
 * whatever the deposit is: 30% up front and three draws over the rest adds to
 * the agreed price, and so does no deposit at all.
 *
 * With no pattern — or terms that bill once — there is exactly one stage: the
 * balance, when the work is done.
 */
export function planFromTerms({
  totalCents,
  depositPercent,
  draws,
  pattern,
}: {
  totalCents: number;
  depositPercent: number | null;
  /** Whether the terms bill in stages at all. */
  draws: boolean;
  pattern: DrawPatternStage[] | null;
}): PlannedStage[] {
  const stages: PlannedStage[] = [];

  const depositCents =
    depositPercent && depositPercent > 0
      ? percentOf(totalCents, depositPercent)
      : 0;

  if (depositCents > 0) {
    stages.push({
      name: "Deposit",
      amountCents: depositCents,
      gate: "on_acceptance",
    });
  }

  const rest = Math.max(totalCents - depositCents, 0);
  const shares =
    draws && pattern?.length ? pattern.filter((stage) => stage.percent > 0) : [];

  if (shares.length === 0) {
    stages.push({
      name: "Final balance",
      amountCents: rest,
      gate: "on_completion",
    });
    return stages;
  }

  const weight = shares.reduce((sum, stage) => sum + stage.percent, 0) || 1;
  let allocated = 0;

  shares.forEach((share, index) => {
    const last = index === shares.length - 1;
    // The last stage takes what remains rather than its own rounded share, so
    // the plan always adds up to the agreement exactly.
    const amountCents = last
      ? rest - allocated
      : Math.round((rest * share.percent) / weight);
    allocated += amountCents;

    stages.push({
      name: share.name.trim() || (last ? "Final balance" : `Stage ${index + 1}`),
      amountCents,
      // The last stage is the balance at the end, and it is the one that
      // carries the settlement.
      gate: last ? "on_completion" : "phase_complete",
    });
  });

  return stages;
}

/**
 * Writes the plan onto the job — called when a quote is accepted and the
 * agreement it reads comes into existence.
 *
 * **A plan the contractor made himself always wins.** If the job already has
 * stages, they stand: they only gain the contract they now read. Overwriting
 * them with the pattern would throw away the split he typed for this job.
 */
export async function seedJobSchedule({
  jobId,
  contractId,
  stages,
  on = db,
}: {
  jobId: string;
  contractId: string | null;
  stages: PlannedStage[];
  on?: Executor;
}): Promise<number> {
  const existing = await on
    .select({ id: drawSchedule.id })
    .from(drawSchedule)
    .where(eq(drawSchedule.jobId, jobId))
    .limit(1);

  if (existing.length > 0) {
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
