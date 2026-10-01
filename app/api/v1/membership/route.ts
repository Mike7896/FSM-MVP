import { requireCaller, requireOrg } from "@/lib/api/auth";
import { handler } from "@/lib/api/handler";
import { ok } from "@/lib/api/response";
import { readAccess } from "@/lib/membership/access";
import { getActivationUsage } from "@/lib/membership/activation";

/**
 * `GET /api/v1/membership` — what this shop has, and what it has used.
 *
 * The same derived access every page reads (Billing §4.1), for the native
 * app. Read-only; access is never taken from a client.
 */
export const GET = handler(async (request) => {
  const caller = await requireCaller(request);
  const { organizationId } = await requireOrg(request, caller);
  const [access, usage] = await Promise.all([
    readAccess(organizationId),
    getActivationUsage(organizationId),
  ]);
  return ok({ access, usage });
});
