import { requireCaller, requireOrg } from "@/lib/api/auth";
import { handlerWithParams } from "@/lib/api/handler";
import { ok } from "@/lib/api/response";
import { invoiceChangeOrder } from "@/lib/change-orders/service";
import { z } from "zod";
export const POST = handlerWithParams<{ id: string }>(async (request, { id }) => {
  const caller = await requireCaller(request);
  const { organizationId } = await requireOrg(request, caller);
  return ok(await invoiceChangeOrder(organizationId, z.uuid().parse(id)));
});
