import { requireAdminCaller } from "@/lib/admin/access";
import { getAccount, updatePolicy } from "@/lib/admin/accounts";
import { setFoundingMember } from "@/lib/admin/invites";
import { accountId } from "@/lib/admin/ids";
import { handlerWithParams, readJson } from "@/lib/api/handler";
import { ApiError, noContent, ok } from "@/lib/api/response";
import { updateAccountPolicySchema } from "@/lib/schemas";

/** `/api/v1/admin/accounts/[id]` — one account: read it, change its settings. */

export const GET = handlerWithParams<{ id: string }>(async (request, { id }) => {
  await requireAdminCaller(request);
  const account = await getAccount(accountId(id));
  if (!account) throw new ApiError("not_found", "No account with that id.");
  return ok(account);
});

export const PATCH = handlerWithParams<{ id: string }>(async (request, { id }) => {
  const admin = await requireAdminCaller(request);
  const { foundingMember, ...change } = await readJson(request, updateAccountPolicySchema);
  if (foundingMember !== undefined) await setFoundingMember(admin, accountId(id), foundingMember);
  if (Object.keys(change).length) await updatePolicy(admin, accountId(id), change);
  return noContent();
});
