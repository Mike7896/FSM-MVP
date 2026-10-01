import { adapterFor, findConnector } from "@/lib/connectors";
import { disconnect } from "@/lib/connectors/store";
import { requireCaller, requireOrg } from "@/lib/api/auth";
import { handlerWithParams } from "@/lib/api/handler";
import { ApiError, noContent } from "@/lib/api/response";
import { BILLING_ROLES } from "@/lib/dal";

/**
 * `DELETE /api/v1/connections/[provider]` — disconnect.
 *
 * **Easy to find and easy to do**, the same posture as cancelling a
 * subscription. A connector a contractor cannot get out of is one their
 * accountant tells them not to get into.
 *
 * **Nothing is deleted on the other side.** The invoices already pushed stay in
 * their books — they are that shop's accounting records, not our cache — and
 * the id mapping stays here so a later reconnect updates those records instead
 * of creating a second copy of every customer. The brief's rule is *never
 * delete in the provider*; keeping the mapping is that rule pointed the other
 * way.
 *
 * **Owner and admin only**, for the same reason connecting is.
 */
export const DELETE = handlerWithParams<{ provider: string }>(
  async (request, params) => {
    const caller = await requireCaller(request);
    const { organizationId } = await requireOrg(request, caller, {
      roles: BILLING_ROLES,
    });

    const connector = findConnector(params.provider);
    if (!connector) {
      throw new ApiError("not_found", "There's no connector by that name.");
    }

    const removed = await disconnect(
      organizationId,
      connector.id,
      adapterFor(connector.id)
    );

    if (!removed) {
      throw new ApiError("not_found", `${connector.name} isn't connected.`);
    }

    return noContent();
  }
);
