import { requireCaller, requireOrg } from "@/lib/api/auth";
import { handlerWithParams, readJson } from "@/lib/api/handler";
import { ok } from "@/lib/api/response";
import { requireFieldJob } from "@/lib/field/access";
import { attachmentSlot } from "@/lib/field/storage";
import { attachmentUploadSchema } from "@/lib/schemas/receipt";
export const POST = handlerWithParams<{ id: string }>(async (request, { id }) => {
  const caller = await requireCaller(request);
  const { organizationId } = await requireOrg(request, caller);
  await requireFieldJob(id, organizationId);
  const body = await readJson(request, attachmentUploadSchema);
  return ok(await attachmentSlot(`${organizationId}/${id}/receipts`, body.fileName));
});
