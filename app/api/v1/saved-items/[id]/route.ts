import { and, eq } from "drizzle-orm";

import { requireCaller, requireOrg, requireSameOrigin } from "@/lib/api/auth";
import { handlerWithParams, readJson } from "@/lib/api/handler";
import { ApiError, ok } from "@/lib/api/response";
import { db } from "@/lib/db";
import { savedItems } from "@/lib/db/schema";
import { requireSavedItem, toSavedItem } from "@/lib/queries/library";
import { savedItemIssues, savedItemPatchSchema } from "@/lib/schemas/library";

/**
 * `/api/v1/saved-items/[id]` — one saved item.
 *
 * `PATCH` renames it or changes its defaults (and, for whoever authors one,
 * its rows and settings). The whole item is checked again after the change, so
 * a new setting list can't strand a formula or a default. `DELETE` removes it
 * and every job's settings for it; quotes it was dropped into keep their rows.
 */
export const PATCH = handlerWithParams<{ id: string }>(async (request, { id }) => {
  requireSameOrigin(request);
  const caller = await requireCaller(request);
  const { organizationId } = await requireOrg(request, caller);
  const body = await readJson(request, savedItemPatchSchema);

  const current = await requireSavedItem(id, organizationId);
  const next = {
    template: body.template ?? current.template,
    settings: body.settings ?? current.settings,
    defaults: body.defaults ?? current.defaults,
    summary: body.summary === undefined ? current.summary : body.summary,
  };

  const issues = savedItemIssues(next);
  if (issues.length) {
    throw new ApiError("invalid_request", issues[0], { issues });
  }

  const [row] = await db
    .update(savedItems)
    .set({
      ...next,
      ...(body.name === undefined ? {} : { name: body.name }),
      updatedAt: new Date(),
    })
    .where(and(eq(savedItems.id, id), eq(savedItems.organizationId, organizationId)))
    .returning();

  return ok(toSavedItem(row));
});

export const DELETE = handlerWithParams<{ id: string }>(async (request, { id }) => {
  requireSameOrigin(request);
  const caller = await requireCaller(request);
  const { organizationId } = await requireOrg(request, caller);

  const deleted = await db
    .delete(savedItems)
    .where(and(eq(savedItems.id, id), eq(savedItems.organizationId, organizationId)))
    .returning({ id: savedItems.id });
  if (!deleted.length) throw new ApiError("not_found", "That saved item doesn't exist.");

  return ok({ deleted: true });
});
