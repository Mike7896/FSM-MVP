import { requireAdminCaller } from "@/lib/admin/access";
import { inviteAccount } from "@/lib/admin/invites";
import { requireSameOrigin } from "@/lib/api/auth";
import { handler, readJson } from "@/lib/api/handler";
import { created } from "@/lib/api/response";
import { inviteAccountSchema } from "@/lib/schemas";

/**
 * `POST /api/v1/admin/invites` — set up a real account for someone and email
 * them the way in. The link comes back too, to text instead or as well.
 */
export const POST = handler(async (request) => {
  requireSameOrigin(request);
  const admin = await requireAdminCaller(request);
  const body = await readJson(request, inviteAccountSchema);
  const invite = await inviteAccount(admin, body, request.nextUrl.origin);
  return created(invite, `/api/v1/admin/accounts/${invite.userId}`);
});
