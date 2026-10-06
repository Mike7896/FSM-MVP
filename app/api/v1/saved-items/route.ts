import { requireCaller, requireOrg, requireSameOrigin } from "@/lib/api/auth";
import { handler, readJson } from "@/lib/api/handler";
import { ApiError, created, ok } from "@/lib/api/response";
import { db } from "@/lib/db";
import { savedItems } from "@/lib/db/schema";
import { requireSavedItems } from "@/lib/membership/features";
import { listSavedItems, toSavedItem } from "@/lib/queries/library";
import { savedItemCreateSchema, savedItemIssues } from "@/lib/schemas/library";

/**
 * `/api/v1/saved-items` — the Office's Library.
 *
 * `GET` lists it. `POST` saves a row, group or assembly into it — the template
 * is a copy, so the quote it came from keeps its own rows untouched.
 */
export const GET = handler(async (request) => {
  const caller = await requireCaller(request);
  const { organizationId } = await requireOrg(request, caller);
  return ok(await listSavedItems(organizationId));
});

export const POST = handler(async (request) => {
  requireSameOrigin(request);
  const caller = await requireCaller(request);
  const { organizationId } = await requireOrg(request, caller);
  const body = await readJson(request, savedItemCreateSchema);
  await requireSavedItems(organizationId);

  const issues = savedItemIssues(body);
  if (issues.length) {
    throw new ApiError("invalid_request", issues[0], { issues });
  }

  const [row] = await db
    .insert(savedItems)
    .values({
      organizationId,
      name: body.name,
      template: body.template,
      settings: body.settings,
      defaults: body.defaults,
      summary: body.summary,
      source: "shop",
      createdBy: caller.userId,
    })
    .returning();

  return created(toSavedItem(row));
});
