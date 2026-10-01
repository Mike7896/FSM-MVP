import { requireCaller, requireOrg } from "@/lib/api/auth";
import { handlerWithParams, readJson } from "@/lib/api/handler";
import { ok } from "@/lib/api/response";
import { sendQuote } from "@/lib/documents";
import { sendQuoteSchema } from "@/lib/schemas";

/**
 * `POST /api/v1/quotes/[id]/send` — the quote goes out.
 *
 * The gate (business name and license), who it may reach (a demo reaches only
 * the sender), the one live link, the delivery and the record of it are all
 * `sendQuote`'s. This endpoint authenticates and hands over.
 */
export const POST = handlerWithParams<{ id: string }>(
  async (request, { id }) => {
    const caller = await requireCaller(request);
    const { organizationId } = await requireOrg(request, caller);
    const input = await readJson(request, sendQuoteSchema);

    return ok(
      await sendQuote({
        organizationId,
        quoteId: id,
        sender: { userId: caller.userId, email: caller.email },
        input,
      })
    );
  }
);
