import "server-only";

import { and, desc, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { jobs, receipts } from "@/lib/db/schema";
import { attachmentUrl } from "@/lib/field/storage";
import { reportError } from "@/lib/observability";

export type ReceiptItem = {
  id: string;
  vendor: string | null;
  amountCents: number;
  description: string | null;
  category: string | null;
  purchasedOn: string | null;
  hasAttachment: boolean;
  attachmentUrl: string | null;
};

export async function listJobReceipts(jobId: string, organizationId: string): Promise<ReceiptItem[]> {
  const rows = await db.select({
    id: receipts.id,
    vendor: receipts.vendor,
    amountCents: receipts.amountCents,
    description: receipts.description,
    category: receipts.category,
    purchasedOn: receipts.purchasedOn,
    imageUrl: receipts.imageUrl,
  }).from(receipts)
    .innerJoin(jobs, eq(receipts.jobId, jobs.id))
    .where(and(eq(jobs.id, jobId), eq(jobs.organizationId, organizationId)))
    .orderBy(desc(receipts.purchasedOn), desc(receipts.capturedAt), desc(receipts.id));

  return Promise.all(rows.map(async ({ imageUrl, ...row }) => {
    let url: string | null = null;
    if (imageUrl) {
      try {
        url = await attachmentUrl(imageUrl, `${organizationId}/${jobId}/receipts`);
      } catch {
        // A storage outage should not hide the recorded expense.
        reportError("[receipts] Could not load an attachment", undefined, { extra: { receipt: row.id } });
      }
    }
    return { ...row, hasAttachment: Boolean(imageUrl), attachmentUrl: url };
  }));
}
