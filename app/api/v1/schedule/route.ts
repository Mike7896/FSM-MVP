import { requireCaller, requireOrg } from "@/lib/api/auth";
import { handler, readQuery } from "@/lib/api/handler";
import { ok } from "@/lib/api/response";
import { listSchedule } from "@/lib/schedule";
import { listScheduleSchema } from "@/lib/schemas";

/**
 * `GET /api/v1/schedule?start&end&startDate&endDate` — everything on in a
 * window: the visits, and the inspections their permits have booked.
 *
 * The browser sends both edges of the window it's showing — as instants for
 * timed visits and as dates for all-day ones — because only it knows which
 * clock the week is being read on.
 */
export const GET = handler(async (request) => {
  const caller = await requireCaller(request);
  const { organizationId } = await requireOrg(request, caller);
  const range = readQuery(request, listScheduleSchema);

  return ok(
    await listSchedule(organizationId, {
      start: new Date(range.start),
      end: new Date(range.end),
      startDate: range.startDate,
      endDate: range.endDate,
    })
  );
});
