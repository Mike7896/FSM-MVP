import { requireCaller, requireOrg } from "@/lib/api/auth";
import { handler } from "@/lib/api/handler";
import { ok } from "@/lib/api/response";
import { listPacks } from "@/lib/queries/office";

/**
 * `/api/v1/packs` — the catalogue, with this shop's state folded in.
 *
 * The pack *content* is a module in the repo rather than a table; what varies
 * per shop is entitlement and enablement, and that is what this joins in. A
 * native client gets the same three facts a page does — what exists, what is
 * paid for, what is running.
 */
export const GET = handler(async (request) => {
  const caller = await requireCaller(request);
  const { organizationId } = await requireOrg(request, caller);

  const states = await listPacks(organizationId);

  return ok(
    states.map((state) => ({
      id: state.pack.id,
      name: state.pack.name,
      summary: state.pack.summary,
      status: state.pack.status,
      contents: state.pack.contents,
      entitled: state.entitled,
      enabled: state.enabled,
      priceCents: state.priceCents,
    }))
  );
});
