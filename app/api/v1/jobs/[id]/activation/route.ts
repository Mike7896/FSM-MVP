import { requireCaller, requireOrg } from "@/lib/api/auth";
import { handlerWithParams, readJson } from "@/lib/api/handler";
import { ok } from "@/lib/api/response";
import { withActivation } from "@/lib/membership/activation";
import { jobActivationSchema } from "@/lib/schemas";

/**
 * `POST /api/v1/jobs/[id]/activation` — a customer-ready copy is about to be
 * printed or saved as a PDF.
 *
 * That is an externally usable commercial action, so it activates the job
 * (Billing §3.1) — once; a job already activated costs nothing. On Free, past
 * the month's three, this is refused and the page offers a watermarked draft
 * instead.
 */
export const POST = handlerWithParams<{ id: string }>(async (request, { id }) => {
  const caller = await requireCaller(request);
  const { organizationId } = await requireOrg(request, caller);
  const body = await readJson(request, jobActivationSchema);
  await withActivation(
    { organizationId, jobId: id, action: body.action, actorUserId: caller.userId },
    async () => undefined
  );
  return ok({ activated: true });
});
