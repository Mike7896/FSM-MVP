import { handlerWithParams, readJson } from "@/lib/api/handler";
import { ok } from "@/lib/api/response";
import { reserveInfoUpload } from "@/lib/field/info-requests";
import { attachmentSlot } from "@/lib/field/storage";
import { attachmentUploadSchema } from "@/lib/schemas/receipt";
export const POST = handlerWithParams<{ token: string; requestId: string }>(async (request, { token, requestId }) => {
  const body = await readJson(request, attachmentUploadSchema);
  const prefix = await reserveInfoUpload(token, requestId);
  return ok(await attachmentSlot(prefix, body.fileName));
});
