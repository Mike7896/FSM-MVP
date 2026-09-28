import "server-only";

import { eq, sql } from "drizzle-orm";

import { db } from "@/lib/db";
import { billingAccounts } from "@/lib/db/schema";
import { notify } from "@/lib/notifications/notify";

/**
 * Telling a shop about its own membership — once per notice.
 *
 * The key is written onto the billing account *before* the notification goes,
 * in the same statement that proves it was not there yet, so a webhook retried
 * three times or a sweep run twice still sends one.
 */
export async function sendNotice(
  organizationId: string,
  notice: { key: string; title: string; body: string; href?: string }
): Promise<boolean> {
  await db
    .insert(billingAccounts)
    .values({ organizationId })
    .onConflictDoNothing();

  const claimed = await db
    .update(billingAccounts)
    .set({ notices: sql`array_append(${billingAccounts.notices}, ${notice.key})` })
    .where(
      sql`${billingAccounts.organizationId} = ${organizationId}
        and not (${notice.key} = any(${billingAccounts.notices}))`
    )
    .returning({ organizationId: billingAccounts.organizationId });

  if (claimed.length === 0) return false;

  await notify({
    kind: "billing.notice",
    organizationId,
    noticeKey: notice.key,
    title: notice.title,
    body: notice.body,
    href: notice.href ?? "/account/billing",
  });
  return true;
}

export async function hasNotice(organizationId: string, key: string) {
  const [row] = await db
    .select({ notices: billingAccounts.notices })
    .from(billingAccounts)
    .where(eq(billingAccounts.organizationId, organizationId))
    .limit(1);
  return Boolean(row?.notices.includes(key));
}
