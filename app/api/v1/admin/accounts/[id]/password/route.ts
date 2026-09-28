import { requireAdminCaller } from "@/lib/admin/access";
import { accountId } from "@/lib/admin/ids";
import { resetPassword } from "@/lib/admin/accounts";
import { handlerWithParams } from "@/lib/api/handler";
import { ok } from "@/lib/api/response";

/**
 * `POST /api/v1/admin/accounts/[id]/password` — set a new password and hand it
 * back, once, to pass on. Only for accounts that already use one.
 */
export const POST = handlerWithParams<{ id: string }>(async (request, { id }) => {
  const admin = await requireAdminCaller(request);
  return ok(await resetPassword(admin, accountId(id)));
});
