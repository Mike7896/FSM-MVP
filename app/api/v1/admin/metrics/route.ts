import { z } from "zod";

import { requireAdminCaller } from "@/lib/admin/access";
import { getAdminMetrics } from "@/lib/admin/metrics";
import { handler, readQuery } from "@/lib/api/handler";
import { ok } from "@/lib/api/response";

const query = z.object({
  tz: z
    .string()
    .max(64)
    .refine((zone) => {
      try {
        new Intl.DateTimeFormat("en-US", { timeZone: zone });
        return true;
      } catch {
        return false;
      }
    })
    .optional(),
});

/** `GET /api/v1/admin/metrics?tz` — every number on the admin dashboard. Admins only. */
export const GET = handler(async (request) => {
  await requireAdminCaller(request);
  const { tz } = readQuery(request, query);
  return ok(await getAdminMetrics(tz ?? "UTC"));
});
