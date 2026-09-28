import { requireCaller, requireOrg } from "@/lib/api/auth";
import { handlerWithParams, readJson } from "@/lib/api/handler";
import { ok } from "@/lib/api/response";
import { sendChangeOrder } from "@/lib/change-orders/service";
import { changeOrderSendSchema } from "@/lib/schemas/change-order";
import { z } from "zod";
import { clientIp } from "@/lib/api/request";

export const POST = handlerWithParams<{ id: string }>(async (request, { id }) => {
  const caller = await requireCaller(request);
  const { organizationId } = await requireOrg(request, caller, { roles: ["owner", "admin"] });
  return ok(await sendChangeOrder(organizationId, z.uuid().parse(id), await readJson(request, changeOrderSendSchema), { ip: clientIp(request), userAgent: request.headers.get("user-agent"), signerEmail: caller.email }));
});
