import "server-only";

import { sql } from "drizzle-orm";

import { db } from "@/lib/db";
import { DomainError } from "@/lib/errors";
import { createAdminClient } from "@/lib/supabase/server";
import { BUCKETS } from "@/lib/supabase/storage";

import { readAccess } from "./access";
import { POLICY } from "./catalog";
import { formatBytes } from "./format";

/**
 * ATTACHMENT STORAGE (§2.2) — 1 GB on Free, 10 GB on Starter, 25 GB on Pro.
 *
 * Measured from what Storage actually holds under the shop's prefix, so the
 * number cannot drift from a counter somebody forgot to decrement. Generated
 * documents are never stored as attachments and so never count.
 *
 * At the quota, **new attachments stop and nothing else does**: documents
 * still send, existing files still open and download, and an export still
 * runs after a downgrade leaves a shop over its new allowance.
 */

export async function storageUsedBytes(organizationId: string): Promise<number> {
  const rows = await db.execute<{ used: string | null }>(sql`
    select coalesce(sum((metadata->>'size')::bigint), 0)::text as used
    from storage.objects
    where bucket_id = ${BUCKETS.jobAttachments}
      and name like ${`${organizationId}/%`}
  `);
  return Number(rows[0]?.used ?? 0);
}

export async function storageUsage(organizationId: string) {
  const [used, access] = await Promise.all([storageUsedBytes(organizationId), readAccess(organizationId)]);
  return { usedBytes: used, limitBytes: access.features.storageBytes, tier: access.tier };
}

export { formatBytes };

/** Refuses a new contractor upload once the shop's storage is full. */
export async function assertCanStoreAttachment(organizationId: string) {
  const usage = await storageUsage(organizationId);
  if (usage.usedBytes >= usage.limitBytes) {
    throw new DomainError(
      `Your attachment storage is full — ${formatBytes(usage.usedBytes)} of ${formatBytes(usage.limitBytes)}. ` +
        `Remove attachments you no longer need, or upgrade for more room. Sending documents isn't affected.`,
      "conflict",
      { reason: "storage_full", usedBytes: usage.usedBytes, limitBytes: usage.limitBytes }
    );
  }
}

/**
 * A file that has landed in Storage is within the 20 MB per-file limit
 * (§2.2). Checked after the upload, because the browser uploads straight to
 * Storage; an oversized file is refused and removed rather than recorded.
 */
export async function assertStoredFileWithinLimit(path: string) {
  const rows = await db.execute<{ size: string | null }>(sql`
    select (metadata->>'size') as size
    from storage.objects
    where bucket_id = ${BUCKETS.jobAttachments} and name = ${path}
    limit 1
  `);
  const metadataSize = rows[0]?.size;
  const size = Number(metadataSize);
  if (metadataSize == null || !Number.isSafeInteger(size) || size <= 0) {
    throw new DomainError("The uploaded file could not be verified. Upload it again before saving.", "invalid");
  }
  if (size > POLICY.maxUploadBytes) {
    // Through the Storage API, never a SQL delete: that would orphan the bytes.
    await createAdminClient().storage.from(BUCKETS.jobAttachments).remove([path]).catch(() => undefined);
    throw new DomainError(`That file is over ${formatBytes(POLICY.maxUploadBytes)}. Use a smaller photo or PDF.`, "invalid");
  }
}
