import { z } from "zod";
import { handlerWithParams, readJson } from "@/lib/api/handler";
import { ok } from "@/lib/api/response";
import { reserveChangeRequest } from "@/lib/change-orders/requests";
import { attachmentSlot } from "@/lib/field/storage";
export const POST = handlerWithParams<{ token: string }>(async (request, { token }) => { const input = await readJson(request, z.object({ id: z.uuid(), fileName: z.string().trim().min(1).max(160) })); const { prefix } = await reserveChangeRequest(token, input.id, true); return ok(await attachmentSlot(prefix, input.fileName)); });
