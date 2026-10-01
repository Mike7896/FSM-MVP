import { requireCaller, requireOrg } from "@/lib/api/auth";
import { handlerWithParams, readJson } from "@/lib/api/handler";
import { ok } from "@/lib/api/response";
import { readChangeOrder, saveChangeOrder, deleteChangeOrder } from "@/lib/change-orders/service";
import { changeOrderSaveSchema } from "@/lib/schemas/change-order";
import { z } from "zod";

export const GET = handlerWithParams<{ id: string }>(async (request, { id }) => {
  const caller = await requireCaller(request);
  const { organizationId } = await requireOrg(request, caller);
  return ok(await readChangeOrder(z.uuid().parse(id), organizationId));
});
export const DELETE = handlerWithParams<{ id: string }>(async (request, { id }) => {
  const caller = await requireCaller(request);
  const { organizationId } = await requireOrg(request, caller);
  return ok(await deleteChangeOrder(organizationId, z.uuid().parse(id)));
});
export const PUT = handlerWithParams<{ id: string }>(async (request, { id }) => {
  const caller = await requireCaller(request);
  const { organizationId } = await requireOrg(request, caller);
  const input = await readJson(request, changeOrderSaveSchema.omit({ id: true }));
  return ok(await saveChangeOrder(organizationId, caller.userId, { ...input, id: z.uuid().parse(id) }));
});
