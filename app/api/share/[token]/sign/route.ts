import { handlerWithParams, readJson } from "@/lib/api/handler";
import { clientIp } from "@/lib/api/request";
import { ok } from "@/lib/api/response";
import { signFromLinkSchema } from "@/lib/schemas";
import { linkedType, signFromLink, signQuoteFromLink } from "@/lib/share";

/**
 * `POST /api/share/[token]/sign` — the customer signs from the link. Flow 2.
 *
 * Two documents are signed here. A **quote** with signature lines is accepted
 * by signing it, which generates the contract already signed by both; a
 * **contract** is signed on its own, after a quote approved with the button.
 * Either way the token is who they are and the audit fields are read off the
 * request, never the body. Answers with where to go next — the deposit's link
 * when signing issued one, the contract's otherwise.
 */
export const POST = handlerWithParams<{ token: string }>(
  async (request, { token }) => {
    const body = await readJson(request, signFromLinkSchema);
    const audit = {
      ip: clientIp(request),
      userAgent: request.headers.get("user-agent"),
    };

    return ok(
      (await linkedType(token)) === "quote"
        ? await signQuoteFromLink(token, body, audit)
        : await signFromLink(token, body, audit)
    );
  }
);
