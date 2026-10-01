import { requireAdminCaller } from "@/lib/admin/access";
import { getLiveUsage } from "@/lib/admin/usage-providers";
import { handler } from "@/lib/api/handler";
import { ok } from "@/lib/api/response";

export const GET = handler(async (request) => {
  await requireAdminCaller(request);
  return ok(await getLiveUsage(), { headers: { "Cache-Control": "private, no-store" } });
});
