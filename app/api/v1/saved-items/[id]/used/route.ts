import { and, eq, sql } from "drizzle-orm";

import { requireCaller, requireOrg, requireSameOrigin } from "@/lib/api/auth";
import { handlerWithParams } from "@/lib/api/handler";
import { ApiError, ok } from "@/lib/api/response";
import { db } from "@/lib/db";
import { savedItems } from "@/lib/db/schema";

/**
 * `POST /api/v1/saved-items/[id]/used` — counts a drop into Scope, for the
 * Library's "Most used" and "Recently used" sorts. The rows themselves are
 * placed by the editor; this only records that it happened.
 */
export const POST = handlerWithParams<{ id: string }>(async (request, { id }) => {
  requireSameOrigin(request);
  const caller = await requireCaller(request);
  const { organizationId } = await requireOrg(request, caller);

  const [row] = await db
    .update(savedItems)
    .set({
      timesUsed: sql`${savedItems.timesUsed} + 1`,
      lastUsedAt: new Date(),
    })
    .where(and(eq(savedItems.id, id), eq(savedItems.organizationId, organizationId)))
    .returning({ timesUsed: savedItems.timesUsed, lastUsedAt: savedItems.lastUsedAt });
  if (!row) throw new ApiError("not_found", "That saved item doesn't exist.");

  return ok({ timesUsed: row.timesUsed, lastUsedAt: row.lastUsedAt?.toISOString() ?? null });
});
