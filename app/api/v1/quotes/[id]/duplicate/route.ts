import { requireCaller, requireOrg } from "@/lib/api/auth";
import { handlerWithParams, readJson } from "@/lib/api/handler";
import { created } from "@/lib/api/response";
import { duplicateQuote } from "@/lib/documents";
import { duplicateQuoteSchema } from "@/lib/schemas";

/**
 * `/api/v1/quotes/[id]/duplicate`
 *
 * The endpoint behind the dashboard's Quick start and the quotes list's
 * Duplicate — **the cheapest form the price book takes**. The rules for what a
 * copy keeps and what it leaves behind are Documents §8's `duplicateQuote`.
 */
export const POST = handlerWithParams<{ id: string }>(
  async (request, { id }) => {
    const caller = await requireCaller(request);
    const { organizationId } = await requireOrg(request, caller);
    const input = await readJson(request, duplicateQuoteSchema);

    const record = await duplicateQuote({
      organizationId,
      userId: caller.userId,
      quoteId: id,
      input,
    });

    return created(record, `/api/v1/quotes/${record.id}`);
  }
);
