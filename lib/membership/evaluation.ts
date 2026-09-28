import "server-only";

import { and, eq, gt, isNull, ne } from "drizzle-orm";

import { db } from "@/lib/db";
import { billingEvents, packEnablement, packEvaluations } from "@/lib/db/schema";
import { DomainError } from "@/lib/errors";

import { readAccess } from "./access";
import { DAY_MS, PACK_LABEL, POLICY, type PackId } from "./catalog";
import { getReleases } from "./releases";

/**
 * THE PACK EVALUATION — 14 days of a pack, no card, once per shop (§3.2).
 *
 * Started deliberately by the owner, never automatically. It unlocks the
 * pack's content and nothing else — no Pro branding, no analytics, no change
 * to the Free job allowance — and it never converts into a charge. Buying the
 * pack ends it early; nothing restarts it.
 */

export async function startEvaluation(input: {
  organizationId: string;
  pack: PackId;
  userId: string;
  ownerEmail: string;
  now?: Date;
}) {
  const now = input.now ?? new Date();
  const name = PACK_LABEL[input.pack];

  const releases = await getReleases();
  if (!releases[`pack_${input.pack}`]) {
    throw new DomainError(`The ${name} pack isn't available yet.`, "conflict");
  }

  const access = await readAccess(input.organizationId, now);
  const state = access.packs[input.pack];
  if (state.purchased) {
    throw new DomainError(`You already have the ${name} pack.`, "conflict");
  }
  if (state.evaluationUsed) {
    throw new DomainError(
      `This shop has already used its ${name} evaluation. It runs once per business.`,
      "conflict"
    );
  }

  // Once per *business*: a shop deleted and signed up again under the same
  // owner is still the same business.
  const email = input.ownerEmail.trim().toLowerCase();
  const [elsewhere] = await db
    .select({ organizationId: packEvaluations.organizationId })
    .from(packEvaluations)
    .where(
      and(
        eq(packEvaluations.packId, input.pack),
        eq(packEvaluations.ownerEmail, email),
        ne(packEvaluations.organizationId, input.organizationId)
      )
    )
    .limit(1);
  if (elsewhere) {
    throw new DomainError(
      `Your business has already used its ${name} evaluation. It runs once per business.`,
      "conflict"
    );
  }

  const expiresAt = new Date(now.getTime() + POLICY.evaluationDays * DAY_MS);

  const inserted = await db
    .insert(packEvaluations)
    .values({
      organizationId: input.organizationId,
      packId: input.pack,
      startedAt: now,
      expiresAt,
      startedBy: input.userId,
      ownerEmail: email,
    })
    .onConflictDoNothing()
    .returning();

  if (inserted.length === 0) {
    throw new DomainError(
      `This shop has already used its ${name} evaluation.`,
      "conflict"
    );
  }

  // An evaluation that starts hidden would be fourteen days nobody sees.
  await db
    .insert(packEnablement)
    .values({ organizationId: input.organizationId, packId: input.pack, enabled: true })
    .onConflictDoUpdate({
      target: [packEnablement.organizationId, packEnablement.packId],
      set: { enabled: true, updatedAt: now },
    });

  await db.insert(billingEvents).values({
    organizationId: input.organizationId,
    actorUserId: input.userId,
    kind: "evaluation.started",
    detail: { pack: input.pack, expiresAt: expiresAt.toISOString() },
  });

  return inserted[0];
}

/** A purchase ends a running evaluation: the paid pack takes over from here. */
export async function endEvaluation(organizationId: string, pack: PackId, now = new Date()) {
  const ended = await db
    .update(packEvaluations)
    .set({ endedAt: now })
    .where(
      and(
        eq(packEvaluations.organizationId, organizationId),
        eq(packEvaluations.packId, pack),
        isNull(packEvaluations.endedAt),
        gt(packEvaluations.expiresAt, now)
      )
    )
    .returning({ packId: packEvaluations.packId });

  if (ended.length) {
    await db.insert(billingEvents).values({
      organizationId,
      kind: "evaluation.ended_by_purchase",
      detail: { pack },
    });
  }
}
