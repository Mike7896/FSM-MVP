import { and, desc, eq, inArray, sql } from "drizzle-orm";

import { requireCaller, requireOrg } from "@/lib/api/auth";
import { handlerWithParams, readJson } from "@/lib/api/handler";
import { ApiError, ok } from "@/lib/api/response";
import { db } from "@/lib/db";
import { documents, drawSchedule, jobs } from "@/lib/db/schema";
import { jobMoney } from "@/lib/queries/jobs";
import { getJobPhases } from "@/lib/queries/phases";
import { formatMoney } from "@/lib/quote";
import { planPhasesSchema } from "@/lib/schemas";

/**
 * `/api/v1/jobs/[id]/phases` — how this job's money is planned to come in.
 *
 * `GET` returns every phase with where it stands and the proof recorded for
 * it — the same rows `/jobs/[id]/complete` renders.
 *
 * `PUT` replaces the plan with the list it is sent, in order. Three rules hold
 * it honest:
 *
 * - **A billed phase is history.** Its amount and when it's due are on an
 *   invoice the customer already has, so they can't change and the phase can't
 *   be removed. Renaming it is fine.
 * - **The plan can't promise more than was agreed.** When the job has an agreed
 *   total, the phases may not add up to more — anything over it is a change
 *   order, not a bigger number on the plan.
 * - **Phases belong to one job.** An id from anywhere else is refused rather
 *   than silently moved.
 */

export const GET = handlerWithParams<{ id: string }>(
  async (request, { id }) => {
    const caller = await requireCaller(request);
    const { organizationId } = await requireOrg(request, caller);

    const phases = await getJobPhases(id, organizationId);
    if (!phases) throw new ApiError("not_found", "No job with that id.");

    return ok(phases);
  }
);

export const PUT = handlerWithParams<{ id: string }>(
  async (request, { id }) => {
    const caller = await requireCaller(request);
    const { organizationId } = await requireOrg(request, caller);

    const [job] = await db
      .select({ id: jobs.id })
      .from(jobs)
      .where(and(eq(jobs.id, id), eq(jobs.organizationId, organizationId)))
      .limit(1);
    if (!job) throw new ApiError("not_found", "No job with that id.");

    const { phases } = await readJson(request, planPhasesSchema);

    const existing = await db
      .select()
      .from(drawSchedule)
      .where(eq(drawSchedule.jobId, id));
    const byId = new Map(existing.map((row) => [row.id, row]));

    if (phases.some((phase) => phase.id && !byId.has(phase.id))) {
      throw new ApiError("invalid_request", "One of those phases isn't on this job.");
    }

    for (const row of existing) {
      if (!row.invoiceId) continue;
      const next = phases.find((phase) => phase.id === row.id);
      if (!next) {
        throw new ApiError(
          "conflict",
          `${row.name} is already billed, so it can't come off the plan.`
        );
      }
      if (next.amountCents !== row.amountCents || next.gate !== row.gate) {
        throw new ApiError(
          "conflict",
          `${row.name} is already billed, so its amount and when it's due are locked.`
        );
      }
    }

    const [contract] = await db
      .select({ id: documents.id })
      .from(documents)
      .where(and(eq(documents.jobId, id), eq(documents.type, "contract")))
      .orderBy(desc(documents.createdAt))
      .limit(1);

    // Only a contract is an agreement. Before one, the quote's total is still
    // a proposal, so the plan isn't held to it.
    const agreedCents = contract
      ? ((await jobMoney([id])).get(id)?.totalCents ?? 0)
      : 0;
    const plannedCents = phases.reduce((sum, phase) => sum + phase.amountCents, 0);
    if (agreedCents > 0 && plannedCents > agreedCents) {
      throw new ApiError(
        "invalid_request",
        `These phases add up to ${formatMoney(plannedCents)}, more than the ${formatMoney(agreedCents)} agreed. Anything over the agreement needs a change order first.`
      );
    }

    const kept = new Set(phases.flatMap((phase) => (phase.id ? [phase.id] : [])));
    const removed = existing
      .filter((row) => !kept.has(row.id))
      .map((row) => row.id);

    await db.transaction(async (tx) => {
      if (removed.length) {
        await tx.delete(drawSchedule).where(inArray(drawSchedule.id, removed));
      }

      // Positions are unique per job, so every row is parked out of the way
      // first — otherwise swapping two phases collides halfway through.
      await tx
        .update(drawSchedule)
        .set({ position: sql`-1 - ${drawSchedule.position}` })
        .where(eq(drawSchedule.jobId, id));

      for (const [position, phase] of phases.entries()) {
        if (phase.id) {
          await tx
            .update(drawSchedule)
            .set({
              name: phase.name,
              amountCents: phase.amountCents,
              gate: phase.gate,
              position,
              updatedAt: new Date(),
            })
            .where(
              and(eq(drawSchedule.id, phase.id), eq(drawSchedule.jobId, id))
            );
        } else {
          await tx.insert(drawSchedule).values({
            jobId: id,
            contractId: contract?.id ?? null,
            name: phase.name,
            amountCents: phase.amountCents,
            gate: phase.gate,
            position,
          });
        }
      }
    });

    return ok(await getJobPhases(id, organizationId));
  }
);
