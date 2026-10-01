import { requireAdminCaller } from "@/lib/admin/access";
import { getUsageProviders, saveUsageProvider } from "@/lib/admin/usage";
import { providerUsageSchema } from "@/lib/admin/usage-model";
import { requireSameOrigin } from "@/lib/api/auth";
import { handler, readJson } from "@/lib/api/handler";
import { ok } from "@/lib/api/response";

export const GET = handler(async (request) => {
  await requireAdminCaller(request);
  return ok(await getUsageProviders(), { headers: { "Cache-Control": "private, no-store" } });
});
export const PUT = handler(async (request) => {
  requireSameOrigin(request);
  const admin = await requireAdminCaller(request);
  await saveUsageProvider(await readJson(request, providerUsageSchema), admin.userId);
  return ok(await getUsageProviders());
});
