import { and, desc, eq, isNotNull, max } from "drizzle-orm";

import { requireCaller, requireOrg } from "@/lib/api/auth";
import { handler } from "@/lib/api/handler";
import { ok } from "@/lib/api/response";
import { db } from "@/lib/db";
import { scopeNodes } from "@/lib/db/schema";
import { isCustomUnit } from "@/lib/quote";

/**
 * `GET /api/v1/units` — the units this Office has made up, most recent first.
 *
 * A unit typed into the picker once ("room", "door") is offered again on the
 * next quote. Read from the rows already written rather than kept as a list of
 * its own, so there is nothing to manage: using a unit is what adds it.
 */
export const GET = handler(async (request) => {
  const caller = await requireCaller(request);
  const { organizationId } = await requireOrg(request, caller);

  const rows = await db
    .select({ unit: scopeNodes.unit, lastUsed: max(scopeNodes.createdAt) })
    .from(scopeNodes)
    .where(
      and(
        eq(scopeNodes.organizationId, organizationId),
        isNotNull(scopeNodes.unit)
      )
    )
    .groupBy(scopeNodes.unit)
    .orderBy(desc(max(scopeNodes.createdAt)))
    .limit(60);

  const units = rows
    .map((row) => row.unit?.trim() ?? "")
    .filter((unit) => unit !== "" && isCustomUnit(unit))
    .slice(0, 20);

  return ok({ units });
});
