import "server-only";

import { and, eq, gt, ne, or, sql } from "drizzle-orm";

import { db } from "@/lib/db";
import { billingAccounts, billingEvents } from "@/lib/db/schema";

import { readAccess } from "./access";
import { DAY_MS, POLICY } from "./catalog";
import { getReleases } from "./releases";

/**
 * THE FOUNDING-MEMBER OFFER (§6).
 *
 * The first fifty paying shops within ninety days of paid launch get founding
 * core prices for as long as their paid membership stays active. **Chosen on
 * the server, never from a price id the browser sent.**
 *
 * A seat is *held* while a founding checkout is open, so the fifty-first shop
 * cannot slip in between the fiftieth starting checkout and paying — and a
 * held seat that is never paid for lapses on its own when the hold expires.
 */

export type FoundingOffer =
  | {
      eligible: true;
      retained: boolean;
      remaining: number | null;
      closesAt: Date | null;
      /** Promised by an admin on invite: open or not, full or not, it's theirs. */
      guaranteed?: boolean;
    }
  | { eligible: false; reason: "off" | "closed" | "full" | "reversed" | "lapsed" };

async function seatsTaken(now: Date, excludingOrganizationId?: string) {
  const [row] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(billingAccounts)
    .where(
      and(
        or(
          eq(billingAccounts.foundingStatus, "enrolled"),
          and(
            eq(billingAccounts.foundingStatus, "held"),
            gt(billingAccounts.foundingHoldUntil, now)
          )
        ),
        excludingOrganizationId
          ? ne(billingAccounts.organizationId, excludingOrganizationId)
          : undefined
      )
    );
  return row?.n ?? 0;
}

export async function foundingOfferFor(
  organizationId: string | null,
  now = new Date()
): Promise<FoundingOffer> {
  if (organizationId) {
    const access = await readAccess(organizationId, now);
    const status = access.founding.status;
    if (status === "reversed") return { eligible: false, reason: "reversed" };
    if (status === "lapsed") return { eligible: false, reason: "lapsed" };
    // Already a founding member: switching plan or interval, or coming back
    // inside the restoration window, keeps the price.
    if (
      status === "enrolled" &&
      (access.standing === "paid" || access.standing === "grace" || access.founding.restorableUntil)
    ) {
      return { eligible: true, retained: true, remaining: null, closesAt: null };
    }
  }

  // Invited as a founding member: the promise was made to them by name, so it
  // doesn't wait on the public offer's switch, window or count. They still
  // take a seat when they pay.
  if (organizationId && (await foundingGuaranteed(organizationId))) {
    return { eligible: true, retained: false, remaining: null, closesAt: null, guaranteed: true };
  }

  const releases = await getReleases();
  if (!releases.founding_offer || !releases.foundingLaunchAt) {
    return { eligible: false, reason: "off" };
  }

  const closesAt = new Date(
    new Date(releases.foundingLaunchAt).getTime() + POLICY.foundingWindowDays * DAY_MS
  );
  if (now.getTime() >= closesAt.getTime()) return { eligible: false, reason: "closed" };

  const taken = await seatsTaken(now, organizationId ?? undefined);
  if (taken >= POLICY.foundingCap) return { eligible: false, reason: "full" };

  return {
    eligible: true,
    retained: false,
    remaining: POLICY.foundingCap - taken,
    closesAt,
  };
}

/** The shop's owner was given founding pricing from the admin panel (an invite, or their account page). */
async function foundingGuaranteed(organizationId: string) {
  const [row] = await db.execute<{ yes: boolean }>(sql`
    select exists (
      select 1 from memberships m join auth.users u on u.id = m.user_id
      where m.organization_id = ${organizationId} and m.role = 'owner'
        and coalesce((u.raw_app_meta_data ->> 'founding_member')::boolean, false)
    ) as yes
  `);
  return Boolean(row?.yes);
}

/**
 * Holds a founding seat for one checkout. Under a lock, so the count it checks
 * is the count it writes against. Returns false when the offer closed or
 * filled in the meantime — the caller then checks out at public prices after
 * telling the shop.
 */
export async function holdFoundingSeat(organizationId: string, now = new Date(), { guaranteed = false } = {}) {
  return db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended('founding-seats', 7))`);

    const [row] = await tx
      .select({ n: sql<number>`count(*)::int` })
      .from(billingAccounts)
      .where(
        and(
          or(
            eq(billingAccounts.foundingStatus, "enrolled"),
            and(eq(billingAccounts.foundingStatus, "held"), gt(billingAccounts.foundingHoldUntil, now))
          ),
          ne(billingAccounts.organizationId, organizationId)
        )
      );
    if (!guaranteed && (row?.n ?? 0) >= POLICY.foundingCap) return false;

    const holdUntil = new Date(now.getTime() + POLICY.foundingHoldMinutes * 60_000);
    await tx
      .insert(billingAccounts)
      .values({ organizationId, foundingStatus: "held", foundingHoldUntil: holdUntil })
      .onConflictDoUpdate({
        target: billingAccounts.organizationId,
        set: { foundingStatus: "held", foundingHoldUntil: holdUntil, updatedAt: now },
      });
    return true;
  });
}

export async function attachFoundingHold(organizationId: string, sessionId: string) {
  await db
    .update(billingAccounts)
    .set({ foundingHoldSession: sessionId })
    .where(
      and(eq(billingAccounts.organizationId, organizationId), eq(billingAccounts.foundingStatus, "held"))
    );
}

/** An abandoned founding checkout gives its seat back. */
export async function releaseFoundingHold(organizationId: string, sessionId: string) {
  const released = await db
    .update(billingAccounts)
    .set({ foundingStatus: "none", foundingHoldUntil: null, foundingHoldSession: null })
    .where(
      and(
        eq(billingAccounts.organizationId, organizationId),
        eq(billingAccounts.foundingStatus, "held"),
        eq(billingAccounts.foundingHoldSession, sessionId)
      )
    )
    .returning({ organizationId: billingAccounts.organizationId });

  if (released.length) {
    await db.insert(billingEvents).values({
      organizationId,
      kind: "founding.hold_released",
      detail: { sessionId },
    });
  }
}
