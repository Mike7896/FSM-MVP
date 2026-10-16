import { requireAdminCaller } from "@/lib/admin/access";
import { accountId } from "@/lib/admin/ids";
import { resendInvite, withdrawInvite } from "@/lib/admin/invites";
import { requireSameOrigin } from "@/lib/api/auth";
import { handlerWithParams, readJson } from "@/lib/api/handler";
import { ok } from "@/lib/api/response";
import { resendInviteSchema } from "@/lib/schemas";

/**
 * `/api/v1/admin/accounts/[id]/invite` — `POST` makes a fresh invite link for
 * someone who hasn't accepted yet, emailed or just handed back (the previous
 * link stops working); the address and note can be corrected on the way.
 * `DELETE` withdraws an invite nobody used, deleting the empty account.
 */
export const POST = handlerWithParams<{ id: string }>(async (request, { id }) => {
  requireSameOrigin(request);
  const admin = await requireAdminCaller(request);
  const body = await readJson(request, resendInviteSchema);
  return ok(await resendInvite(admin, accountId(id), body, request.nextUrl.origin));
});

export const DELETE = handlerWithParams<{ id: string }>(async (request, { id }) => {
  requireSameOrigin(request);
  const admin = await requireAdminCaller(request);
  return ok(await withdrawInvite(admin, accountId(id)));
});
