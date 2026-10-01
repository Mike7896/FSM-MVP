import { handlerWithParams, readJson } from "@/lib/api/handler";
import { ok } from "@/lib/api/response";
import { answerInfoRequest } from "@/lib/field/info-requests";
import { answerInfoRequestSchema } from "@/lib/schemas/info-request";
export const POST = handlerWithParams<{ token: string; requestId: string }>(async (request, { token, requestId }) => {
  const body = await readJson(request, answerInfoRequestSchema);
  return ok(await answerInfoRequest(token, requestId, body));
});
