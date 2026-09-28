import { z } from "zod";

import { requireCaller, requireOrg } from "@/lib/api/auth";
import { handler, readJson } from "@/lib/api/handler";
import { noContent } from "@/lib/api/response";
import { db } from "@/lib/db";
import { userPresence } from "@/lib/db/schema";

/**
 * `POST /api/v1/presence` — "I've got the app open", about once a minute.
 *
 * **Only the area, never the page.** "Quotes" is enough to feel the app being
 * used; "/quotes/<id>" would be watching somebody work, which is not what the
 * admin dashboard is for.
 */
const body = z.object({
  area: z.string().regex(/^[a-z-]{1,24}$/),
  device: z.enum(["phone", "computer"]).optional(),
});

export const POST = handler(async (request) => {
  const caller = await requireCaller(request);
  const { area, device } = await readJson(request, body);
  const organizationId = await requireOrg(request, caller)
    .then((org) => org.organizationId)
    .catch(() => null);

  await db
    .insert(userPresence)
    .values({ userId: caller.userId, organizationId, area, device: device ?? null, lastSeen: new Date() })
    .onConflictDoUpdate({
      target: userPresence.userId,
      set: { organizationId, area, device: device ?? null, lastSeen: new Date() },
    });
  return noContent();
});
