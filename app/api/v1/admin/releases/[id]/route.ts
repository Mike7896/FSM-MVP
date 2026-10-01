import { and, eq, isNull } from "drizzle-orm";
import { z } from "zod";
import { requireAdminCaller } from "@/lib/admin/access";
import { handlerWithParams, readJson } from "@/lib/api/handler";
import { ApiError, ok } from "@/lib/api/response";
import { db } from "@/lib/db";
import { productReleases } from "@/lib/db/schema";
import { releaseInput } from "@/lib/schemas/product-release";

export const PATCH = handlerWithParams<{ id: string }>(async (request, { id }) => {
  await requireAdminCaller(request);
  if (!z.uuid().safeParse(id).success) throw new ApiError("not_found", "Release not found.");
  const input = await readJson(request, z.discriminatedUnion("action", [
    z.object({ action: z.literal("publish") }),
    releaseInput.extend({ action: z.literal("save") }),
  ]));
  const values = input.action === "publish" ? { publishedAt: new Date() } : { title: input.title, items: input.items };
  const [row] = await db.update(productReleases).set(values).where(and(eq(productReleases.id, id), isNull(productReleases.publishedAt))).returning();
  if (!row) throw new ApiError("conflict", "This release was already published or no longer exists. Published releases are kept unchanged.");
  return ok(row);
});
