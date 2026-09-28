import { requireAdminCaller } from "@/lib/admin/access";
import { handler } from "@/lib/api/handler";
import { ok } from "@/lib/api/response";
import { runMembershipSweep } from "@/lib/membership/sweep";

/**
 * `POST /api/v1/admin/billing/sweep` — run the membership sweep now.
 *
 * The same job the accounts cron runs (dunning and evaluation reminders, the
 * day-30 write-off, reconciliation of missed webhooks). Here for while the
 * crons are off on the Hobby plan, and for checking it by hand.
 */
export const POST = handler(async (request) => {
  await requireAdminCaller(request);
  return ok(await runMembershipSweep());
});
