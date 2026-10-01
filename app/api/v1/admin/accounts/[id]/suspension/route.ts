import { requireAdminCaller } from "@/lib/admin/access";
import { accountId } from "@/lib/admin/ids";
import { liftSuspension, suspendAccount } from "@/lib/admin/accounts";
import { handlerWithParams, readJson } from "@/lib/api/handler";
import { noContent } from "@/lib/api/response";
import { suspendSchema } from "@/lib/schemas";

/**
 * `/api/v1/admin/accounts/[id]/suspension` — `PUT` suspends (Supabase Auth
 * bans the account, so sign-in and refresh stop at once), `DELETE` lifts it.
 */
export const PUT = handlerWithParams<{ id: string }>(async (request, { id }) => {
  const admin = await requireAdminCaller(request);
  const { reason } = await readJson(request, suspendSchema);
  await suspendAccount(admin, accountId(id), reason);
  return noContent();
});

export const DELETE = handlerWithParams<{ id: string }>(async (request, { id }) => {
  const admin = await requireAdminCaller(request);
  await liftSuspension(admin, accountId(id));
  return noContent();
});
