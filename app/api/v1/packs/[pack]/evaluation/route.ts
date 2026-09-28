import { requireCaller, requireOrg } from "@/lib/api/auth";
import { handlerWithParams } from "@/lib/api/handler";
import { ApiError, created } from "@/lib/api/response";
import { BILLING_ROLES } from "@/lib/dal";
import { PACK_IDS, type PackId } from "@/lib/membership/catalog";
import { startEvaluation } from "@/lib/membership/evaluation";

/**
 * `POST /api/v1/packs/[pack]/evaluation` — start the pack's 14-day evaluation.
 *
 * Started by the owner, deliberately. No card, no automatic charge, once per
 * business (Billing §3.2).
 */
export const POST = handlerWithParams<{ pack: string }>(async (request, { pack }) => {
  const caller = await requireCaller(request);
  const { organizationId } = await requireOrg(request, caller, { roles: BILLING_ROLES });
  if (!PACK_IDS.includes(pack as PackId)) {
    throw new ApiError("not_found", "There's no such trade pack to evaluate.");
  }
  const evaluation = await startEvaluation({
    organizationId,
    pack: pack as PackId,
    userId: caller.userId,
    ownerEmail: caller.email,
  });
  return created(evaluation);
});
