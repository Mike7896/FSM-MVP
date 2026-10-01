import { handlerWithParams } from "@/lib/api/handler";
import { ok } from "@/lib/api/response";
import { approveFromLink } from "@/lib/share";

/**
 * `POST /api/share/[token]/accept` — the customer approves the quote. Flow 2.
 *
 * No session, and there never will be one: the token is the authorization, and
 * it has to carry the `accept` scope. Answers with the contract's link, which
 * is where the customer goes next.
 */
export const POST = handlerWithParams<{ token: string }>(
  async (_request, { token }) => ok(await approveFromLink(token))
);
