import { z } from "zod";

import { requireAdminCaller } from "@/lib/admin/access";
import { eventsAfter } from "@/lib/admin/events";
import { handler, readQuery } from "@/lib/api/handler";
import { ok } from "@/lib/api/response";

const query = z.object({ after: z.coerce.number().int().min(0) });

/**
 * `GET /api/v1/admin/events?after` — every log line after the last one the
 * live feed has, so a push it missed still shows up. Admins only.
 */
export const GET = handler(async (request) => {
  await requireAdminCaller(request);
  const { after } = readQuery(request, query);
  return ok(await eventsAfter(after), { headers: { "Cache-Control": "private, no-store" } });
});
