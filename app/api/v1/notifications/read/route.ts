import { requireCaller, requireOrg } from "@/lib/api/auth";
import { handler, readJson } from "@/lib/api/handler";
import { noContent } from "@/lib/api/response";
import { markRead } from "@/lib/notifications";
import { markNotificationsReadSchema } from "@/lib/schemas";

/** `POST /api/v1/notifications/read` — `{ ids }` or `{ all: true }`. */
export const POST = handler(async (request) => {
  const caller = await requireCaller(request);
  const { organizationId } = await requireOrg(request, caller);
  const body = await readJson(request, markNotificationsReadSchema);

  await markRead(caller.userId, organizationId, "all" in body ? "all" : body.ids);
  return noContent();
});
