import { requireCaller, requireOrg } from "@/lib/api/auth";
import { handler, readJson, readQuery } from "@/lib/api/handler";
import { created, ok } from "@/lib/api/response";
import { createQuote } from "@/lib/documents";
import { listQuotes } from "@/lib/queries/quotes";
import { createQuoteSchema, listQuotesSchema } from "@/lib/schemas";

/**
 * `/api/v1/quotes`
 *
 * The Quote is the one name for a priced document and the only place pricing is
 * decided. Creating one creates whatever it needs underneath it — a Customer
 * from a typed name, a Job to hang it off — and those rules live in
 * `createQuote`, where every client meets the same ones.
 *
 * Writes live behind a route handler rather than a Server Function because the
 * native app is a real client of this endpoint, and it authenticates with a
 * bearer token rather than a cookie.
 */

export const GET = handler(async (request) => {
  const caller = await requireCaller(request);
  const { organizationId } = await requireOrg(request, caller);
  const query = readQuery(request, listQuotesSchema);

  return ok(await listQuotes(organizationId, query));
});

export const POST = handler(async (request) => {
  const caller = await requireCaller(request);
  const { organizationId } = await requireOrg(request, caller);
  const input = await readJson(request, createQuoteSchema);

  const record = await createQuote({
    organizationId,
    userId: caller.userId,
    input,
  });

  return created(record, `/api/v1/quotes/${record.id}`);
});
