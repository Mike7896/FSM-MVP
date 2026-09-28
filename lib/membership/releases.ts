import "server-only";

import { cache } from "react";
import { eq } from "drizzle-orm";

import { db } from "@/lib/db";
import { billingEvents, billingReleases } from "@/lib/db/schema";

import { RELEASE_KEYS, type ReleaseKey } from "./catalog";

/**
 * Release switches — what is built and also *sold*.
 *
 * Read once per request. A missing row is off, so a new environment offers
 * nothing it was not told to.
 */

export type Releases = Record<ReleaseKey, boolean> & {
  /** When paid launch happened, for the founding window (§6). ISO or null. */
  foundingLaunchAt: string | null;
};

export const getReleases = cache(async (): Promise<Releases> => {
  const rows = await db.select().from(billingReleases);
  const byKey = new Map(rows.map((row) => [row.key, row]));

  const releases = Object.fromEntries(
    RELEASE_KEYS.map((key) => [key, byKey.get(key)?.enabled ?? false])
  ) as Record<ReleaseKey, boolean>;

  const launch = byKey.get("founding_offer")?.config?.launchedAt;

  return {
    ...releases,
    foundingLaunchAt: typeof launch === "string" ? launch : null,
  };
});

/** Admin only — the caller has checked. Recorded in the billing log. */
export async function setRelease(
  key: ReleaseKey,
  change: { enabled?: boolean; config?: Record<string, unknown> },
  actorUserId: string
) {
  const [existing] = await db
    .select()
    .from(billingReleases)
    .where(eq(billingReleases.key, key))
    .limit(1);

  const enabled = change.enabled ?? existing?.enabled ?? false;
  const config = change.config
    ? { ...(existing?.config ?? {}), ...change.config }
    : (existing?.config ?? null);

  await db
    .insert(billingReleases)
    .values({ key, enabled, config, updatedAt: new Date(), updatedBy: actorUserId })
    .onConflictDoUpdate({
      target: billingReleases.key,
      set: { enabled, config, updatedAt: new Date(), updatedBy: actorUserId },
    });

  await db.insert(billingEvents).values({
    organizationId: null,
    actorUserId,
    kind: "release.changed",
    detail: { key, enabled, config },
  });
}
