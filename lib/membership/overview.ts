import "server-only";

import { getDefaultPaymentMethod, listReceipts } from "@/lib/queries/billing";

import { getAccess } from "./access";
import { getActivationUsage } from "./activation";
import { billFor, currentBill } from "./bill";
import type { PackId } from "./catalog";
import { storageUsage } from "./storage";

/**
 * Everything the Account and Billing screens say about a membership, in one
 * read: what is paid for, what it costs, what changes next, what has been
 * used, and the card it comes from.
 */
export async function getBillingOverview(organizationId: string) {
  const access = await getAccess(organizationId);
  const [bill, usage, storage, card, receipts] = await Promise.all([
    currentBill(access),
    getActivationUsage(organizationId),
    storageUsage(organizationId).catch(() => null),
    getDefaultPaymentMethod(organizationId),
    listReceipts(organizationId, 12),
  ]);

  const scheduled = access.scheduled;
  const nextBill =
    scheduled && scheduled.tier && scheduled.interval
      ? await billFor(
          { tier: scheduled.tier, interval: scheduled.interval, packs: scheduled.packs as PackId[] },
          access.founding.price
        )
      : null;

  return { access, bill, nextBill, usage, storage, card, receipts };
}

export type BillingOverview = Awaited<ReturnType<typeof getBillingOverview>>;
