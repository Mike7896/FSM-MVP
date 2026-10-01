import { z } from "zod";
import { handlerWithParams, readJson } from "@/lib/api/handler";
import { ok } from "@/lib/api/response";
import { submitChangeRequest } from "@/lib/change-orders/requests";
const schema = z.object({ id: z.uuid(), body: z.string().trim().min(1).max(8000), photoPaths: z.array(z.string().max(500)).max(3).default([]) }).refine(v => new Set(v.photoPaths).size === v.photoPaths.length, "Choose distinct photos.");
export const POST = handlerWithParams<{ token: string }>(async (request, { token }) => { const input = await readJson(request, schema); return ok(await submitChangeRequest(token, input.id, input.body, input.photoPaths)); });
