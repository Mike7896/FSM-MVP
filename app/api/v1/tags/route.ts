import { z } from "zod";
import { and, eq } from "drizzle-orm";
import { requireCaller, requireOrg, requireSameOrigin } from "@/lib/api/auth";
import { handler, readJson } from "@/lib/api/handler";
import { ApiError, ok } from "@/lib/api/response";
import { db } from "@/lib/db";
import { tags } from "@/lib/db/schema";
import { listTags } from "@/lib/queries/tags";
import { tagSchema } from "@/lib/tags";

export const GET = handler(async (request) => {
  const { organizationId } = await requireOrg(
    request,
    await requireCaller(request),
  );
  return ok(await listTags(organizationId));
});
export const POST = handler(async (request) => {
  requireSameOrigin(request);
  const { organizationId } = await requireOrg(
    request,
    await requireCaller(request),
  );
  const body = await readJson(request, tagSchema);
  const [tag] = await db
    .insert(tags)
    .values({ ...body, organizationId })
    .onConflictDoNothing()
    .returning();
  if (!tag)
    throw new ApiError("conflict", "A tag with that name already exists.");
  return ok(tag);
});
export const PATCH = handler(async (request) => {
  requireSameOrigin(request);
  const { organizationId } = await requireOrg(
    request,
    await requireCaller(request),
  );
  const { id, ...body } = await readJson(
    request,
    tagSchema.extend({ id: z.uuid() }),
  );
  try {
    const [tag] = await db
      .update(tags)
      .set(body)
      .where(and(eq(tags.id, id), eq(tags.organizationId, organizationId)))
      .returning();
    if (!tag) throw new ApiError("not_found", "Tag not found.");
    return ok(tag);
  } catch (error) {
    const cause = error as { cause?: { code?: string }; code?: string };
    if ((cause.cause?.code ?? cause.code) === "23505")
      throw new ApiError("conflict", "A tag with that name already exists.");
    throw error;
  }
});
export const DELETE = handler(async (request) => {
  requireSameOrigin(request);
  const { organizationId } = await requireOrg(
    request,
    await requireCaller(request),
  );
  const { id } = await readJson(request, z.object({ id: z.uuid() }));
  const deleted = await db
    .delete(tags)
    .where(and(eq(tags.id, id), eq(tags.organizationId, organizationId)))
    .returning();
  if (!deleted.length) throw new ApiError("not_found", "Tag not found.");
  return ok({ deleted: true });
});
