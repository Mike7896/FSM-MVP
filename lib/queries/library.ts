import "server-only";

import { and, desc, eq } from "drizzle-orm";

import { ApiError } from "@/lib/api/response";
import { db } from "@/lib/db";
import { jobItemSettings, jobs, savedItems, type SavedItemRow } from "@/lib/db/schema";
import type { JobItemSettings, SavedItem } from "@/lib/library/types";

/** A row as the API returns it. */
export function toSavedItem(row: SavedItemRow): SavedItem {
  return {
    id: row.id,
    name: row.name,
    template: row.template,
    settings: row.settings,
    defaults: row.defaults,
    summary: row.summary,
    imageUrl: row.imageUrl,
    source: row.source,
    packId: row.packId,
    timesUsed: row.timesUsed,
    lastUsedAt: row.lastUsedAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

/** The Office's Library, newest first. The panel sorts and filters it on the client. */
export async function listSavedItems(organizationId: string): Promise<SavedItem[]> {
  const rows = await db
    .select()
    .from(savedItems)
    .where(eq(savedItems.organizationId, organizationId))
    .orderBy(desc(savedItems.createdAt))
    .limit(1000);
  return rows.map(toSavedItem);
}

/** One saved item, for a page — null where it isn't this Office's. */
export async function getSavedItem(
  id: string,
  organizationId: string
): Promise<SavedItem | null> {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
  const [row] = await db
    .select()
    .from(savedItems)
    .where(and(eq(savedItems.id, id), eq(savedItems.organizationId, organizationId)))
    .limit(1);
  return row ? toSavedItem(row) : null;
}

export async function requireSavedItem(
  id: string,
  organizationId: string
): Promise<SavedItemRow> {
  const [row] = await db
    .select()
    .from(savedItems)
    .where(and(eq(savedItems.id, id), eq(savedItems.organizationId, organizationId)))
    .limit(1);
  if (!row) throw new ApiError("not_found", "That saved item doesn't exist.");
  return row;
}

/** Proves the job is this Office's before its settings are read or written. */
export async function requireOfficeJob(jobId: string, organizationId: string) {
  const [job] = await db
    .select({ id: jobs.id })
    .from(jobs)
    .where(and(eq(jobs.id, jobId), eq(jobs.organizationId, organizationId)))
    .limit(1);
  if (!job) throw new ApiError("not_found", "That job doesn't exist.");
  return job;
}

/** A job's own settings, keyed by saved item. */
export async function listJobItemSettings(
  jobId: string,
  organizationId: string
): Promise<JobItemSettings> {
  const rows = await db
    .select({ savedItemId: jobItemSettings.savedItemId, values: jobItemSettings.values })
    .from(jobItemSettings)
    .where(
      and(
        eq(jobItemSettings.jobId, jobId),
        eq(jobItemSettings.organizationId, organizationId)
      )
    );
  return Object.fromEntries(rows.map((row) => [row.savedItemId, row.values]));
}
