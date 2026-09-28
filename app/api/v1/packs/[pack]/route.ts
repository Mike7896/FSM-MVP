import { requireCaller, requireOrg } from "@/lib/api/auth";
import { handlerWithParams, readJson } from "@/lib/api/handler";
import { ApiError, ok } from "@/lib/api/response";
import { BILLING_ROLES } from "@/lib/dal";
import { db } from "@/lib/db";
import { packEnablement } from "@/lib/db/schema";
import { readAccess } from "@/lib/membership/access";
import { PACK_IDS, PACK_LABEL, packLookupKey, type PackId } from "@/lib/membership/catalog";
import { amountFor } from "@/lib/membership/prices";
import { findPack } from "@/lib/packs/catalog";
import { formatMoney } from "@/lib/quote/money";
import { updatePackSchema } from "@/lib/schemas";

/**
 * `/api/v1/packs/[pack]` — showing or hiding a trade pack.
 *
 * **Enablement only — it never buys or cancels anything** (Billing §4.1). A
 * shop can switch on a pack it is entitled to (paid for, or in its 14-day
 * evaluation); entitlement itself is derived from Stripe and recorded
 * evaluations, never granted from here. Switching off is always allowed, and
 * the answer says plainly that the bill carries on.
 */
export const PATCH = handlerWithParams<{ pack: string }>(
  async (request, { pack: packId }) => {
    const caller = await requireCaller(request);
    const { organizationId } = await requireOrg(request, caller, {
      roles: BILLING_ROLES,
    });

    const pack = findPack(packId);
    if (!pack || !PACK_IDS.includes(packId as PackId)) {
      throw new ApiError("not_found", "There's no such trade pack.");
    }

    const body = await readJson(request, updatePackSchema);
    const access = await readAccess(organizationId);
    const state = access.packs[packId as PackId];

    if (body.enabled && !state.entitled) {
      throw new ApiError(
        "forbidden",
        `The ${pack.name} pack isn't on your membership yet.`
      );
    }

    const [row] = await db
      .insert(packEnablement)
      .values({ organizationId, packId, enabled: body.enabled })
      .onConflictDoUpdate({
        target: [packEnablement.organizationId, packEnablement.packId],
        set: { enabled: body.enabled, updatedAt: new Date() },
      })
      .returning();

    return ok({ ...row, notice: await noticeFor(packId as PackId, body.enabled, access) });
  }
);

async function noticeFor(
  pack: PackId,
  enabled: boolean,
  access: Awaited<ReturnType<typeof readAccess>>
) {
  const name = PACK_LABEL[pack];
  const state = access.packs[pack];
  if (enabled) return `${name} is showing in your workspace again.`;
  if (!state.purchased || !access.interval) {
    return `Hidden from your workspace. Quotes already written with it are untouched.`;
  }
  const cents = await amountFor(packLookupKey(pack, access.interval));
  const price = cents === null ? "" : ` at ${formatMoney(cents)}/${access.interval === "year" ? "year" : "month"}`;
  const renews = access.currentPeriodEnd
    ? `, renewing ${access.currentPeriodEnd.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" })}`
    : "";
  return `Hidden from your workspace. Your ${name} subscription continues${price}${renews}. Manage billing to cancel.`;
}
