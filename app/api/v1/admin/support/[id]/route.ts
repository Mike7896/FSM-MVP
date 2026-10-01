import { and, eq } from "drizzle-orm";
import { z } from "zod";

import { requireAdminCaller } from "@/lib/admin/access";
import { handlerWithParams, readJson } from "@/lib/api/handler";
import { ApiError, noContent } from "@/lib/api/response";
import { db } from "@/lib/db";
import { supportRequests } from "@/lib/db/schema";

/**
 * `PATCH /api/v1/admin/support/[id]` — mark a support request answered or
 * closed (or open again). The sender sees the new status in their Help page.
 */
export const PATCH = handlerWithParams<{ id: string }>(async (request, { id }) => {
  await requireAdminCaller(request);
  if (!z.uuid().safeParse(id).success) throw new ApiError("not_found", "No such request.");
  const { status } = await readJson(request, z.object({ status: z.enum(["open", "answered", "closed"]) }));

  const updated = await db
    .update(supportRequests)
    .set({ status, updatedAt: new Date() })
    .where(and(eq(supportRequests.id, id)))
    .returning({ id: supportRequests.id });
  if (!updated.length) throw new ApiError("not_found", "No such request.");
  return noContent();
});
