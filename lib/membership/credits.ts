import "server-only";

import { and, asc, eq, inArray, isNull, sql } from "drizzle-orm";

import { db } from "@/lib/db";
import { aiCreditEntries, billingAccounts, type AiCreditEntry } from "@/lib/db/schema";
import { DomainError } from "@/lib/errors";

import { readAccess } from "./access";
import { AI_TARIFF, type AiAction } from "./catalog";
import { getReleases } from "./releases";

/**
 * AI CREDITS (§7) — the ledger, built before anything is sold.
 *
 * Nothing calls these from the product until the `ai_credits` release is on;
 * `npm run membership:check` holds them to the spec in the meantime. Credits
 * are lots (a monthly grant, a purchase) and movements against lots (reserve,
 * release, settle, expire, refund). Balances are sums, never a stored number.
 *
 * - Included credits expire with their monthly window and are spent first.
 * - Purchased credits never expire while the account exists; oldest first.
 * - A reservation is taken before a call and settled once after a usable
 *   result, or released on failure. Retries reuse the operation id, so one
 *   action is never charged twice. No negative balance, no overage.
 */

/** A monthly service window on the subscription's anniversary, in UTC (§7.1). */
export function creditWindow(anchor: Date, now: Date) {
  const day = anchor.getUTCDate();
  const at = (year: number, month: number) => {
    // The last valid day for shorter months.
    const last = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
    return new Date(
      Date.UTC(year, month, Math.min(day, last), anchor.getUTCHours(), anchor.getUTCMinutes(), anchor.getUTCSeconds())
    );
  };
  let year = now.getUTCFullYear();
  let month = now.getUTCMonth();
  let start = at(year, month);
  if (start.getTime() > now.getTime()) {
    month -= 1;
    if (month < 0) { month = 11; year -= 1; }
    start = at(year, month);
  }
  const nextMonth = month === 11 ? 0 : month + 1;
  const nextYear = month === 11 ? year + 1 : year;
  const end = at(nextYear, nextMonth);
  return { key: start.toISOString().slice(0, 10), start, end };
}

type Lot = AiCreditEntry & { remaining: number };

async function lots(organizationId: string, now: Date, on: Pick<typeof db, "select"> = db): Promise<Lot[]> {
  const rows = await on
    .select()
    .from(aiCreditEntries)
    .where(eq(aiCreditEntries.organizationId, organizationId))
    .orderBy(asc(aiCreditEntries.createdAt));

  const heads = rows.filter((row) => row.lotId === null);
  return heads
    .map((head) => ({
      ...head,
      remaining:
        head.credits +
        rows.filter((row) => row.lotId === head.id).reduce((sum, row) => sum + row.credits, 0),
    }))
    .filter((lot) => !lot.expiresAt || lot.expiresAt.getTime() > now.getTime() || lot.remaining > 0);
}

export async function creditBalance(organizationId: string, now = new Date()) {
  const all = await lots(organizationId, now);
  const spendable = all.filter((lot) => !lot.expiresAt || lot.expiresAt.getTime() > now.getTime());
  const included = spendable.filter((lot) => lot.kind === "grant").reduce((sum, lot) => sum + Math.max(0, lot.remaining), 0);
  const purchased = spendable.filter((lot) => lot.kind === "purchase").reduce((sum, lot) => sum + Math.max(0, lot.remaining), 0);
  const promo = spendable.filter((lot) => lot.kind === "promo").reduce((sum, lot) => sum + Math.max(0, lot.remaining), 0);
  return { included, purchased, promo, total: included + purchased + promo };
}

/** This window's included credits for a paid Pro shop, once per window (§7.1). */
export async function grantIncludedCredits(organizationId: string, now = new Date()) {
  const [releases, access] = await Promise.all([getReleases(), readAccess(organizationId, now)]);
  if (!releases.ai_credits) return null;
  // Grace issues nothing new until the renewal is paid.
  if (access.standing !== "paid" && access.standing !== "comp") return null;
  const amount = access.tier === "pro" ? AI_TARIFF.proIncludedPerWindow : AI_TARIFF.starterIncludedPerWindow;
  if (amount <= 0) return null;

  const [account] = await db
    .select({ anchor: billingAccounts.currentPeriodStart })
    .from(billingAccounts)
    .where(eq(billingAccounts.organizationId, organizationId))
    .limit(1);
  const window = creditWindow(account?.anchor ?? now, now);

  const [row] = await db
    .insert(aiCreditEntries)
    .values({
      organizationId,
      kind: "grant",
      credits: amount,
      windowKey: window.key,
      expiresAt: window.end,
      note: "Included with Pro",
    })
    .onConflictDoNothing()
    .returning();
  return row ?? null;
}

/** Reserve an action's credits before running it. Idempotent per operation. */
export async function reserveCredits(input: {
  organizationId: string;
  operationId: string;
  action: AiAction;
  now?: Date;
}) {
  const now = input.now ?? new Date();
  const cost = AI_TARIFF.actions[input.action];

  return db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${input.organizationId}::text, 11))`);

    const existing = await tx
      .select()
      .from(aiCreditEntries)
      .where(and(eq(aiCreditEntries.organizationId, input.organizationId), eq(aiCreditEntries.operationId, input.operationId), eq(aiCreditEntries.kind, "reserve")));
    if (existing.length) return { reserved: -existing.reduce((sum, row) => sum + row.credits, 0), repeated: true };

    const available = (await lots(input.organizationId, now, tx))
      .filter((lot) => lot.remaining > 0 && (!lot.expiresAt || lot.expiresAt.getTime() > now.getTime()))
      // Expiring included credits first, then purchased oldest first (§7.1).
      .sort((a, b) => {
        const rank = (lot: Lot) => (lot.kind === "grant" ? 0 : lot.kind === "promo" ? 1 : 2);
        return rank(a) - rank(b) || a.createdAt.getTime() - b.createdAt.getTime();
      });

    const total = available.reduce((sum, lot) => sum + lot.remaining, 0);
    if (total < cost) {
      throw new DomainError(`This needs ${cost} credits and you have ${total}. Nothing was charged.`, "conflict", {
        reason: "credits_insufficient",
        needed: cost,
        available: total,
      });
    }

    let left: number = cost;
    for (const lot of available) {
      if (left === 0) break;
      const take = Math.min(left, lot.remaining);
      await tx.insert(aiCreditEntries).values({
        organizationId: input.organizationId,
        kind: "reserve",
        lotId: lot.id,
        credits: -take,
        operationId: input.operationId,
        note: input.action,
      });
      left -= take;
    }
    return { reserved: cost, repeated: false };
  });
}

async function movementsFor(organizationId: string, operationId: string) {
  return db
    .select()
    .from(aiCreditEntries)
    .where(and(eq(aiCreditEntries.organizationId, organizationId), eq(aiCreditEntries.operationId, operationId)));
}

/** A usable result was delivered: the reservation becomes final. Once. */
export async function settleCredits(organizationId: string, operationId: string) {
  const rows = await movementsFor(organizationId, operationId);
  if (rows.some((row) => row.kind === "release")) {
    throw new DomainError("That operation's credits were already released.", "conflict");
  }
  for (const reserve of rows.filter((row) => row.kind === "reserve")) {
    await db
      .insert(aiCreditEntries)
      .values({ organizationId, kind: "settle", lotId: reserve.lotId, credits: 0, operationId })
      .onConflictDoNothing();
  }
}

/** The provider failed, or timed out with no result: every reserved credit comes back. Once. */
export async function releaseCredits(organizationId: string, operationId: string) {
  const rows = await movementsFor(organizationId, operationId);
  if (rows.some((row) => row.kind === "settle")) return;
  for (const reserve of rows.filter((row) => row.kind === "reserve")) {
    await db
      .insert(aiCreditEntries)
      .values({ organizationId, kind: "release", lotId: reserve.lotId, credits: -reserve.credits, operationId })
      .onConflictDoNothing();
  }
}

/** Included credits do not roll over (§7.1). */
export async function expireCredits(organizationId: string, now = new Date()) {
  for (const lot of await lots(organizationId, now)) {
    if (lot.kind === "grant" && lot.expiresAt && lot.expiresAt.getTime() <= now.getTime() && lot.remaining > 0) {
      await db
        .insert(aiCreditEntries)
        .values({ organizationId, kind: "expire", lotId: lot.id, credits: -lot.remaining, operationId: `expire:${lot.id}` })
        .onConflictDoNothing();
    }
  }
}

/** A confirmed top-up payment becomes spendable credits — only after it is confirmed (§7.2). */
export async function recordCreditPurchase(input: {
  organizationId: string;
  paymentIntentId: string;
  credits: number;
  amountCents: number;
}) {
  const [row] = await db
    .insert(aiCreditEntries)
    .values({
      organizationId: input.organizationId,
      kind: "purchase",
      credits: input.credits,
      sourceRef: input.paymentIntentId,
      unitPriceMicros: Math.round((input.amountCents * 100) / input.credits),
      note: "Top-up",
    })
    .onConflictDoNothing()
    .returning();
  return row ?? null;
}

/**
 * Refunding a top-up revokes its unused credits first (§7.2) and says what
 * the unused part cost — never a refund that leaves credits spendable.
 */
export async function revokeCreditPurchase(organizationId: string, paymentIntentId: string, now = new Date()) {
  const lot = (await lots(organizationId, now)).find((row) => row.kind === "purchase" && row.sourceRef === paymentIntentId);
  if (!lot || lot.remaining <= 0) return { revoked: 0, refundableCents: 0 };
  await db
    .insert(aiCreditEntries)
    .values({ organizationId, kind: "refund", lotId: lot.id, credits: -lot.remaining, operationId: `refund:${paymentIntentId}` })
    .onConflictDoNothing();
  return {
    revoked: lot.remaining,
    refundableCents: Math.floor((lot.remaining * (lot.unitPriceMicros ?? 0)) / 100),
  };
}

/** Lots still open, for the sweep. */
export async function organizationsWithCredits() {
  const rows = await db
    .selectDistinct({ organizationId: aiCreditEntries.organizationId })
    .from(aiCreditEntries)
    .where(and(isNull(aiCreditEntries.lotId), inArray(aiCreditEntries.kind, ["grant"])));
  return rows.map((row) => row.organizationId);
}
