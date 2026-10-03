import { and, eq } from "drizzle-orm";

import { requireCaller, requireOrg, requireSameOrigin } from "@/lib/api/auth";
import { handlerWithParams, readJson } from "@/lib/api/handler";
import { ApiError, ok } from "@/lib/api/response";
import { db } from "@/lib/db";
import { jobItemSettings } from "@/lib/db/schema";
import { isValidSetting } from "@/lib/library/expand";
import {
  listJobItemSettings,
  requireOfficeJob,
  requireSavedItem,
} from "@/lib/queries/library";
import { jobItemSettingsPutSchema } from "@/lib/schemas/library";

/**
 * `/api/v1/jobs/[id]/item-settings` — this job's own settings for saved items.
 *
 * `GET` returns them keyed by saved item. `PUT` replaces one item's settings
 * for this job; an empty `values` clears them, so the item goes back to the
 * Office's defaults on this job. They never change the defaults or any other
 * job.
 */
export const GET = handlerWithParams<{ id: string }>(async (request, { id }) => {
  const caller = await requireCaller(request);
  const { organizationId } = await requireOrg(request, caller);
  await requireOfficeJob(id, organizationId);
  return ok(await listJobItemSettings(id, organizationId));
});

export const PUT = handlerWithParams<{ id: string }>(async (request, { id }) => {
  requireSameOrigin(request);
  const caller = await requireCaller(request);
  const { organizationId } = await requireOrg(request, caller);
  const body = await readJson(request, jobItemSettingsPutSchema);

  await requireOfficeJob(id, organizationId);
  const item = await requireSavedItem(body.savedItemId, organizationId);

  for (const [key, value] of Object.entries(body.values)) {
    const def = item.settings.find((candidate) => candidate.key === key);
    if (!def) throw new ApiError("invalid_request", `"${key}" isn't one of ${item.name}'s settings.`);
    if (!isValidSetting(def, value)) {
      throw new ApiError("invalid_request", `That value doesn't fit ${def.label}.`);
    }
  }

  const where = and(
    eq(jobItemSettings.jobId, id),
    eq(jobItemSettings.savedItemId, item.id)
  );

  if (Object.keys(body.values).length === 0) {
    await db.delete(jobItemSettings).where(where);
  } else {
    await db
      .insert(jobItemSettings)
      .values({
        jobId: id,
        savedItemId: item.id,
        organizationId,
        values: body.values,
      })
      .onConflictDoUpdate({
        target: [jobItemSettings.jobId, jobItemSettings.savedItemId],
        set: { values: body.values, updatedAt: new Date() },
      });
  }

  return ok(await listJobItemSettings(id, organizationId));
});
