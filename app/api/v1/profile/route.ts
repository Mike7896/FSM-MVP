import { eq, inArray } from "drizzle-orm";

import { requireCaller } from "@/lib/api/auth";
import { handler, readJson } from "@/lib/api/handler";
import { ApiError, ok } from "@/lib/api/response";
import { db } from "@/lib/db";
import { memberships, organizations, profiles } from "@/lib/db/schema";
import { updateProfileSchema } from "@/lib/schemas";

/**
 * `PATCH /api/v1/profile` — the signed-in person's own small facts.
 *
 * The trade from the one-tap question, and the two one-time moments after a
 * first send that must never come back once seen. Scoped to the caller, never
 * an id from the request.
 *
 * **The trade belongs to the business once there is one.** Activation asks it
 * before the Office exists, so it lands on the profile and the Office copies it
 * when it is created; a contractor who already has an Office writes both.
 */
export const PATCH = handler(async (request) => {
  const caller = await requireCaller(request);
  const body = await readJson(request, updateProfileSchema);
  const now = new Date();

  const [row] = await db
    .update(profiles)
    .set({
      ...(body.trade ? { trade: body.trade } : {}),
      ...(body.teachSeen ? { teachSeenAt: now } : {}),
      ...(body.offersDismissed ? { offersDismissedAt: now } : {}),
      updatedAt: now,
    })
    .where(eq(profiles.id, caller.userId))
    .returning({
      trade: profiles.trade,
      teachSeenAt: profiles.teachSeenAt,
      offersDismissedAt: profiles.offersDismissedAt,
    });

  if (!row) throw new ApiError("not_found", "There's no profile for this sign-in.");

  if (body.trade) {
    await db
      .update(organizations)
      .set({ trade: body.trade, updatedAt: now })
      .where(
        inArray(
          organizations.id,
          db
            .select({ id: memberships.organizationId })
            .from(memberships)
            .where(eq(memberships.userId, caller.userId))
        )
      );
  }

  return ok(row);
});
