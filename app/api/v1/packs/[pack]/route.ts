import { and, eq, isNull } from "drizzle-orm";

import { requireCaller, requireOrg } from "@/lib/api/auth";
import { handlerWithParams, readJson } from "@/lib/api/handler";
import { ApiError, ok } from "@/lib/api/response";
import { BILLING_ROLES } from "@/lib/dal";
import { db } from "@/lib/db";
import { packEnablement, packEntitlements } from "@/lib/db/schema";
import { findPack } from "@/lib/packs/catalog";
import { updatePackSchema } from "@/lib/schemas";

/**
 * `/api/v1/packs/[pack]` — switching a trade pack on or off.
 *
 * **Enablement only.** Owning a pack and running one are separate states, and
 * only the second is a product decision the client gets to make. Granting an
 * entitlement from here would be handing out a paid feature on the caller's
 * say-so — entitlements are written by the Stripe webhook that saw the money
 * move, and nothing else writes that table.
 *
 * So a request to enable a pack the shop is not entitled to is refused rather
 * than quietly upgrading them, and a request to *disable* one is always allowed:
 * a contractor who works two trades needs to switch one off without losing it
 * or re-buying it.
 */
export const PATCH = handlerWithParams<{ pack: string }>(
  async (request, { pack: packId }) => {
    const caller = await requireCaller(request);
    const { organizationId } = await requireOrg(request, caller, {
      roles: BILLING_ROLES,
    });

    const pack = findPack(packId);
    if (!pack) throw new ApiError("not_found", "There's no such trade pack.");

    const body = await readJson(request, updatePackSchema);

    if (body.enabled) {
      const [entitlement] = await db
        .select({ packId: packEntitlements.packId })
        .from(packEntitlements)
        .where(
          and(
            eq(packEntitlements.organizationId, organizationId),
            eq(packEntitlements.packId, packId),
            isNull(packEntitlements.revokedAt)
          )
        )
        .limit(1);

      if (!entitlement) {
        throw new ApiError(
          "forbidden",
          `The ${pack.name} pack isn't on your subscription yet.`
        );
      }
    }

    const [row] = await db
      .insert(packEnablement)
      .values({ organizationId, packId, enabled: body.enabled })
      .onConflictDoUpdate({
        target: [packEnablement.organizationId, packEnablement.packId],
        set: { enabled: body.enabled, updatedAt: new Date() },
      })
      .returning();

    return ok(row);
  }
);
