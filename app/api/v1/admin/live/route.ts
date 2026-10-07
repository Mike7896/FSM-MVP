import { requireAdminCaller } from "@/lib/admin/access";
import { newestEvents } from "@/lib/admin/events";
import { recentPresence } from "@/lib/admin/presence";
import { handler } from "@/lib/api/handler";
import { ok } from "@/lib/api/response";

/** Reconcile the visible feed window and presence after subscribing/reconnecting. */
export const GET = handler(async (request) => {
  await requireAdminCaller(request);
  // Re-read the whole bounded feed, not id > last realtime event: sequence IDs
  // can commit out of order, and a push can arrive before this snapshot.
  const events = await newestEvents(500);
  const presence = await recentPresence();
  return ok({ events, presence }, { headers: { "Cache-Control": "private, no-store" } });
});
