import { revalidatePath } from "next/cache";
import { z } from "zod";

import { requireAdminCaller } from "@/lib/admin/access";
import { handlerWithParams, readJson } from "@/lib/api/handler";
import { ApiError, ok } from "@/lib/api/response";
import { RELEASE_KEYS, type ReleaseKey } from "@/lib/membership/catalog";
import { getReleases, setRelease } from "@/lib/membership/releases";

/**
 * `PATCH /api/v1/admin/billing/releases/[key]` — sell something, or stop.
 *
 * A release decides what customers can buy (Billing §2.2, §14.2), so it is an
 * owner's call, and every change lands in the billing log with who made it.
 * Turning one off never takes anything away from a shop that already paid.
 */
const bodySchema = z.object({
  enabled: z.boolean().optional(),
  /** The founding offer's paid-launch date (§6). */
  launchedAt: z.iso.datetime().nullable().optional(),
});

export const PATCH = handlerWithParams<{ key: string }>(async (request, { key }) => {
  const caller = await requireAdminCaller(request);
  if (!caller.owner) throw new ApiError("forbidden", "Only an owner can change what's on sale.");
  if (!RELEASE_KEYS.includes(key as ReleaseKey)) throw new ApiError("not_found", "No such release.");

  const body = await readJson(request, bodySchema);
  await setRelease(
    key as ReleaseKey,
    {
      enabled: body.enabled,
      ...(body.launchedAt !== undefined ? { config: { launchedAt: body.launchedAt } } : {}),
    },
    caller.userId
  );
  // The public pages quote what's on sale — show the change now, not in five minutes.
  revalidatePath("/pricing");
  revalidatePath("/for/[trade]", "page");
  return ok(await getReleases());
});
