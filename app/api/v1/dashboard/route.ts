import { requireCaller, requireOrg } from "@/lib/api/auth";
import { handler } from "@/lib/api/handler";
import { ok } from "@/lib/api/response";
import { getDashboard } from "@/lib/queries/dashboard";

/**
 * `/api/v1/dashboard`
 *
 * The same rows the web dashboard renders, for the native app.
 *
 * **The sentences come from the server, not the client.** It would be more
 * conventional to return counts and ids and let each client word them, and that
 * is exactly what would let the phone and the web say the same fact
 * differently — "went quiet" on one and "no response" on the other, about the
 * same quote. The wording is content design, it is derived from the same status
 * set, and it belongs in one place.
 *
 * Read-only by design. Every row carries an `href` and an `action` verb; the
 * writes those verbs lead to are the endpoints for the objects themselves —
 * quotes, invoices, jobs — because a dashboard action is never a dashboard
 * mutation, it is an ordinary mutation the dashboard happened to suggest.
 */
export const GET = handler(async (request) => {
  const caller = await requireCaller(request);
  const { organizationId } = await requireOrg(request, caller);

  return ok(await getDashboard(organizationId));
});
