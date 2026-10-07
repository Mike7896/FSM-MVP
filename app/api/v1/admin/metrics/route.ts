import { z } from "zod";

import { METRIC_GROUPS } from "@/lib/admin/live-refresh";
import { requireAdminCaller } from "@/lib/admin/access";
import { getAdminMetrics, getAdminMetricGroup } from "@/lib/admin/metrics";
import { handler, readQuery } from "@/lib/api/handler";
import { ok } from "@/lib/api/response";

const query = z.object({
  group: z.enum(METRIC_GROUPS).optional(),
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
  const { tz, group } = readQuery(request, query);
  return ok(group ? await getAdminMetricGroup(tz ?? "UTC", group) : await getAdminMetrics(tz ?? "UTC"), { headers: { "Cache-Control": "private, no-store" } });
});
