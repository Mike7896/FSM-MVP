import { requireCaller, requireOrg } from "@/lib/api/auth";
import { handler, readQuery } from "@/lib/api/handler";
import { ok } from "@/lib/api/response";
import { getSettings, listInbox } from "@/lib/notifications";
import { listNotificationsSchema } from "@/lib/schemas";

/**
 * `GET /api/v1/notifications` — the caller's notifications in the Office
 * they're working in: the bell's list, and what's arrived since `after` for
 * the pop-ups. `toasts` says whether they want pop-ups at all, so one request
 * answers everything the header asks.
 */
export const GET = handler(async (request) => {
  const caller = await requireCaller(request);
  const { organizationId } = await requireOrg(request, caller);
  const { after } = readQuery(request, listNotificationsSchema);

  const [inbox, settings] = await Promise.all([
    listInbox(caller.userId, organizationId, {
      after: after ? new Date(after) : undefined,
    }),
    getSettings(caller.userId),
  ]);

  return ok({ ...inbox, toasts: settings.toasts });
});
