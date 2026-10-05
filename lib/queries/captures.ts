import "server-only";

import { and, asc, count, eq } from "drizzle-orm";

import { db } from "@/lib/db";
import { captureArtifacts, jobs } from "@/lib/db/schema";
import { BUCKETS, createSignedDownloadUrl } from "@/lib/supabase/storage";
import { reportError } from "@/lib/observability";

/**
 * What was recorded on site, for the panel beside the editor.
 *
 * Scoped through `jobs` because a capture has no organization of its own — it
 * belongs to a Job, and the Job belongs to the shop. Drizzle bypasses RLS, so
 * the join is the check.
 *
 * Ordered by when it was captured, not by kind. The panel is a record of a
 * walkthrough and it has to read in the order the walkthrough happened —
 * grouping photos away from the note taken thirty seconds later is what makes
 * a capture log stop answering "what did she say about the hallway".
 */
export type CaptureItem = {
  id: string;
  kind: "note" | "photo" | "measurement" | "audio";
  body: string | null;
  /** A signed, short-lived read URL — never the stored path. */
  fileUrl: string | null;
  flag: string | null;
  /** ISO string — this crosses to a Client Component. */
  capturedAt: string;
  usedInQuote: boolean;
  /** Set once the photo is proof for a phase; it can't be proof for another. */
  promotedToEvidenceId: string | null;
};

export async function listCaptures(
  jobId: string,
  organizationId: string
): Promise<CaptureItem[]> {
  const rows = await db
    .select({
      id: captureArtifacts.id,
      kind: captureArtifacts.kind,
      body: captureArtifacts.body,
      fileUrl: captureArtifacts.fileUrl,
      flag: captureArtifacts.flag,
      capturedAt: captureArtifacts.capturedAt,
      usedInQuote: captureArtifacts.usedInQuote,
      promotedToEvidenceId: captureArtifacts.promotedToEvidenceId,
    })
    .from(captureArtifacts)
    .innerJoin(jobs, eq(captureArtifacts.jobId, jobs.id))
    .where(
      and(
        eq(captureArtifacts.jobId, jobId),
        eq(jobs.organizationId, organizationId)
      )
    )
    .orderBy(asc(captureArtifacts.capturedAt));

  /**
   * The column stores the **storage path**; the panel needs something an
   * `<img>` can load. The bucket is private, so a URL is minted per read and
   * expires — which is why the path is what gets persisted and the URL never
   * is. Signed in parallel because a twenty-item walkthrough would otherwise
   * be twenty sequential round trips before the editor renders.
   */
  return Promise.all(
    rows.map(async (row) => ({
      ...row,
      capturedAt: row.capturedAt.toISOString(),
      fileUrl: row.fileUrl ? await signQuietly(row.fileUrl) : null,
    }))
  );
}

/**
 * How many things were captured on a job — for the job page's row, which needs
 * the number and not a signed URL per photo.
 */
export async function countCaptures(
  jobId: string,
  organizationId: string
): Promise<number> {
  const [row] = await db
    .select({ count: count() })
    .from(captureArtifacts)
    .innerJoin(jobs, eq(captureArtifacts.jobId, jobs.id))
    .where(
      and(
        eq(captureArtifacts.jobId, jobId),
        eq(jobs.organizationId, organizationId)
      )
    );
  return row?.count ?? 0;
}

/**
 * A file that will not sign is a missing thumbnail, not a broken editor.
 *
 * The panel already draws a placeholder for a capture with no image, so a
 * Storage hiccup degrades to the same thing rather than taking the whole desk
 * layout down with it.
 */
async function signQuietly(path: string): Promise<string | null> {
  try {
    return await createSignedDownloadUrl(BUCKETS.jobAttachments, path);
  } catch (error) {
    reportError("[captures] couldn't sign a capture file:", error);
    return null;
  }
}
