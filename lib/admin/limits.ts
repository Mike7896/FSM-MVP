import "server-only";

import { eq, sql } from "drizzle-orm";

import { db } from "@/lib/db";
import { accountPolicies } from "@/lib/db/schema";
import { DomainError } from "@/lib/errors";

/**
 * Limits an admin put on one account — kept apart from the rest of account
 * management so the send path only loads what it checks.
 */

/**
 * Whether this person may send another document now. A tester account with a
 * daily cap gets a sentence saying so when it's reached; everyone else always
 * may.
 */
export async function checkSendAllowance(
  userId: string,
  /** The pool, or a check script's transaction. */
  on: Pick<typeof db, "select" | "execute"> = db
) {
  const [policy] = await on
    .select({ limit: accountPolicies.dailySendLimit })
    .from(accountPolicies)
    .where(eq(accountPolicies.userId, userId))
    .limit(1);
  if (policy?.limit === null || policy?.limit === undefined) return;

  const [row] = await on.execute<{ n: number }>(
    sql`select count(*)::int as n from document_sends where sent_by = ${userId} and sent_at > now() - interval '24 hours'`
  );
  if ((row?.n ?? 0) >= policy.limit) {
    throw new DomainError(
      `This test account can send ${policy.limit} ${policy.limit === 1 ? "document" : "documents"} a day, and that's been reached. It frees up as the day's sends are 24 hours old.`,
      "forbidden"
    );
  }
}
