import { requireCaller, requireOrg } from "@/lib/api/auth";
import { handlerWithParams } from "@/lib/api/handler";
import { ok } from "@/lib/api/response";
import { issueDrawInvoice } from "@/lib/documents";

/**
 * `POST /api/v1/jobs/[id]/phases/[phaseId]/bill` — bill a finished phase.
 *
 * **The gate is checked in the operation, not here.** A phase is billable when
 * the work is done and photographed, or when its inspection passed — and the
 * answer has to be the same whether the ask comes from this route, the native
 * app or a script.
 *
 * Answers with the bill and the link that can pay it. Sending it is a separate
 * act, with the contractor's own words on it.
 */
export const POST = handlerWithParams<{ id: string; phaseId: string }>(
  async (request, { id, phaseId }) => {
    const caller = await requireCaller(request);
    const { organizationId } = await requireOrg(request, caller);

    return ok(
      await issueDrawInvoice({ organizationId, jobId: id, phaseId })
    );
  }
);
