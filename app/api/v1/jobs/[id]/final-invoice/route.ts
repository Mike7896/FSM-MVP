import { jobSettlement } from "@/lib/billing";
import { requireCaller, requireOrg } from "@/lib/api/auth";
import { handlerWithParams } from "@/lib/api/handler";
import { ApiError, ok } from "@/lib/api/response";
import { issueFinalInvoice } from "@/lib/documents";

/**
 * `/api/v1/jobs/[id]/final-invoice` — the balance at the end of the job.
 *
 * `GET` is the settlement as it stands: agreed, billed, collected, and what a
 * final bill would therefore ask for. It is the same read the invoice itself is
 * built from, so the number on the screen and the number on the bill cannot
 * come apart.
 *
 * `POST` issues it, with the deposit and every draw already taken off.
 */
export const GET = handlerWithParams<{ id: string }>(async (request, { id }) => {
  const caller = await requireCaller(request);
  const { organizationId } = await requireOrg(request, caller);

  const settlement = await jobSettlement(id, organizationId);
  if (!settlement) {
    throw new ApiError(
      "not_found",
      "Nothing is agreed on this job yet, so there's no balance to settle."
    );
  }

  return ok(settlement);
});

export const POST = handlerWithParams<{ id: string }>(async (request, { id }) => {
  const caller = await requireCaller(request);
  const { organizationId } = await requireOrg(request, caller);

  return ok(await issueFinalInvoice({ organizationId, jobId: id }));
});
