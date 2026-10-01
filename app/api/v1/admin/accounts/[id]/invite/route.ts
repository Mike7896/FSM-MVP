import { requireAdminCaller } from "@/lib/admin/access";
import { accountId } from "@/lib/admin/ids";
import { resendInvite } from "@/lib/admin/invites";
import { requireSameOrigin } from "@/lib/api/auth";
import { handlerWithParams, readJson } from "@/lib/api/handler";
import { ok } from "@/lib/api/response";
import { resendInviteSchema } from "@/lib/schemas";

/**
 * `POST /api/v1/admin/accounts/[id]/invite` — a fresh invite link for someone
 * who hasn't accepted yet, emailed or just handed back. The previous link stops
 * working.
 */
export const POST = handlerWithParams<{ id: string }>(async (request, { id }) => {
  requireSameOrigin(request);
  const admin = await requireAdminCaller(request);
  const { send } = await readJson(request, resendInviteSchema);
  return ok(await resendInvite(admin, accountId(id), send, request.nextUrl.origin));
});
