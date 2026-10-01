import { and, eq } from "drizzle-orm";

import { requireCaller, requireOrg } from "@/lib/api/auth";
import { handlerWithParams } from "@/lib/api/handler";
import { ApiError, noContent } from "@/lib/api/response";
import { db } from "@/lib/db";
import { captureArtifacts, jobs } from "@/lib/db/schema";
import { BUCKETS, removeObjects } from "@/lib/supabase/storage";

/**
 * `/api/v1/captures/[id]` — removing one.
 *
 * Addressed by the capture rather than by the job, because deleting is always
 * something done to a specific artifact the contractor is looking at. Scoping
 * still happens through the Job in the same statement: a capture has no
 * organization of its own, and Drizzle bypasses RLS, so the join is the check.
 *
 * **A capture that has been promoted to Evidence is not deleted here.** Once it
 * is proof attached to a draw the customer has seen, it stops being a private
 * note and becomes part of what was shown for money — and removing it would
 * take a photograph out of a record she has already been asked to pay against.
 *
 * The file goes with the row. A private object nobody can reach any more is a
 * bucket that grows forever, and the failure is deliberately non-fatal: an
 * orphaned object is a cleanup job, whereas a delete that refuses because
 * Storage was briefly unreachable is a row the contractor cannot get rid of.
 */
export const DELETE = handlerWithParams<{ id: string }>(
  async (request, { id }) => {
    const caller = await requireCaller(request);
    const { organizationId } = await requireOrg(request, caller);

    const [capture] = await db
      .select({
        id: captureArtifacts.id,
        fileUrl: captureArtifacts.fileUrl,
        promotedToEvidenceId: captureArtifacts.promotedToEvidenceId,
      })
      .from(captureArtifacts)
      .innerJoin(jobs, eq(captureArtifacts.jobId, jobs.id))
      .where(
        and(
          eq(captureArtifacts.id, id),
          eq(jobs.organizationId, organizationId)
        )
      )
      .limit(1);

    if (!capture) throw new ApiError("not_found", "That capture doesn't exist.");

    if (capture.promotedToEvidenceId) {
      throw new ApiError(
        "conflict",
        "This one is attached to a draw as evidence. Remove it from the evidence first — your customer has already been shown it."
      );
    }

    await db.delete(captureArtifacts).where(eq(captureArtifacts.id, id));

    if (capture.fileUrl) {
      try {
        await removeObjects(BUCKETS.jobAttachments, [capture.fileUrl]);
      } catch (error) {
        console.error("[captures] row deleted, file left behind:", error);
      }
    }

    return noContent();
  }
);
