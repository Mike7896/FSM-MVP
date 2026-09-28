import { handlerWithParams, readJson } from "@/lib/api/handler";
import { ok } from "@/lib/api/response";
import { decideChangeOrder } from "@/lib/change-orders/service";
import { changeOrderDecisionSchema } from "@/lib/schemas/change-order";
import { clientIp } from "@/lib/api/request";

export const POST = handlerWithParams<{ token: string }>(async (request, { token }) => ok(await decideChangeOrder(token, await readJson(request, changeOrderDecisionSchema), { ip: clientIp(request), userAgent: request.headers.get("user-agent") })));
