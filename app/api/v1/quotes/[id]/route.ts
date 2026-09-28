import { requireCaller, requireOrg } from "@/lib/api/auth";
import { handlerWithParams, readJson } from "@/lib/api/handler";
import { ApiError, noContent, ok } from "@/lib/api/response";
import { deleteQuote, saveQuote } from "@/lib/documents";
import { getQuote } from "@/lib/queries/quotes";
import { updateQuoteSchema } from "@/lib/schemas";

/**
 * `/api/v1/quotes/[id]`
 *
 * The editor's autosave target. Everything the contractor changes comes back
 * through the one PATCH, and `saveQuote` replaces the Scope tree as a set in the
 * same transaction as the document — so a dropped request can never leave rows
 * that don't add up to the total he was looking at.
 *
 * An accepted quote is frozen; the operation says so in words before the
 * database would refuse it with a driver message.
 */

export const GET = handlerWithParams<{ id: string }>(
  async (request, { id }) => {
    const caller = await requireCaller(request);
    const { organizationId } = await requireOrg(request, caller);

    const record = await getQuote(id, organizationId);
    if (!record) {
      throw new ApiError("not_found", "No quote with that id in this shop.");
    }
    return ok(record);
  }
);

export const PATCH = handlerWithParams<{ id: string }>(
  async (request, { id }) => {
    const caller = await requireCaller(request);
    const { organizationId } = await requireOrg(request, caller);
    const input = await readJson(request, updateQuoteSchema);

    return ok(await saveQuote({ organizationId, quoteId: id, input }));
  }
);

export const DELETE = handlerWithParams<{ id: string }>(
  async (request, { id }) => {
    const caller = await requireCaller(request);
    const { organizationId } = await requireOrg(request, caller);

    await deleteQuote({ organizationId, quoteId: id });
    return noContent();
  }
);
