import { z } from "zod";

import { requireCaller } from "@/lib/api/auth";
import { handlerWithParams, readJson } from "@/lib/api/handler";
import { ApiError, noContent } from "@/lib/api/response";
import { linkSupportRequestSchema } from "@/lib/schemas";
import { linkSentryEvent } from "@/lib/support";

/**
 * `PATCH /api/v1/support/[id]` — note the Sentry event the browser filed the
 * request as, so either can be found from the other. Only the sender's own.
 */
export const PATCH = handlerWithParams<{ id: string }>(async (request, { id }) => {
  const caller = await requireCaller(request);
  if (!z.uuid().safeParse(id).success) {
    throw new ApiError("not_found", "That request isn't one of yours.");
  }
  const { sentryEventId } = await readJson(request, linkSupportRequestSchema);
  if (!(await linkSentryEvent(caller.userId, id, sentryEventId))) {
    throw new ApiError("not_found", "That request isn't one of yours.");
  }
  return noContent();
});
