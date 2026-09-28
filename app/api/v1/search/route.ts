import { requireCaller, requireOrg } from "@/lib/api/auth";
import { handler, readQuery } from "@/lib/api/handler";
import { ok } from "@/lib/api/response";
import { searchEverything, searchKind } from "@/lib/queries/search";
import { searchQuerySchema } from "@/lib/schemas";

/**
 * `GET /api/v1/search` — the header's search box.
 *
 * Answers `{ groups }` either way, so the client has one shape to render: all
 * six groups when nothing is named, and one group when a list is asking for
 * its own next page.
 *
 * Scoped to the caller's organization inside every query. A search that
 * returned another shop's customer — even a name with no link behind it —
 * would be the worst kind of leak, because it is the kind nobody reports.
 */
export const GET = handler(async (request) => {
  const caller = await requireCaller(request);
  const { organizationId } = await requireOrg(request, caller);
  const { q, kind, limit, offset } = readQuery(request, searchQuerySchema);

  const groups = kind
    ? [await searchKind(organizationId, kind, q, { limit, offset })]
    : await searchEverything(organizationId, q, limit);

  return ok({ groups });
});
