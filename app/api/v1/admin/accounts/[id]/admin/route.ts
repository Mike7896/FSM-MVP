import { requireAdminCaller } from "@/lib/admin/access";
import { accountId } from "@/lib/admin/ids";
import { setAdmin } from "@/lib/admin/accounts";
import { handlerWithParams, readJson } from "@/lib/api/handler";
import { noContent } from "@/lib/api/response";
import { setAdminSchema } from "@/lib/schemas";

/** `PUT /api/v1/admin/accounts/[id]/admin` — make someone an admin, or not. */
export const PUT = handlerWithParams<{ id: string }>(async (request, { id }) => {
  const admin = await requireAdminCaller(request);
  const { on } = await readJson(request, setAdminSchema);
  await setAdmin(admin, accountId(id), on);
  return noContent();
});
