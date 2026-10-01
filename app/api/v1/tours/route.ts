import { requireCaller } from "@/lib/api/auth";
import { handler } from "@/lib/api/handler";
import { ok } from "@/lib/api/response";
import { listTourProgress } from "@/lib/queries/tours";

/**
 * `GET /api/v1/tours` — where the caller is in every tour they have started.
 *
 * The web app reads the same rows server-side in its layouts, so it never
 * fetches this. It is here for a client with no server render — the native app.
 */
export const GET = handler(async (request) => {
  const caller = await requireCaller(request);
  return ok(await listTourProgress(caller.userId));
});
