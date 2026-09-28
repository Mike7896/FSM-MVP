import { and, eq } from "drizzle-orm";

import { requireCaller, requireOrg } from "@/lib/api/auth";
import { assertStoredFileWithinLimit } from "@/lib/membership/storage";
import { handlerWithParams, readJson } from "@/lib/api/handler";
import { ApiError, created, ok } from "@/lib/api/response";
import { db } from "@/lib/db";
import { captureArtifacts, jobs } from "@/lib/db/schema";
import { listCaptures } from "@/lib/queries/captures";
import { createCaptureSchema } from "@/lib/schemas";

/**
 * `/api/v1/jobs/[id]/captures` — what was recorded on this job.
 *
 * **A capture belongs to a Job and to nothing else**, which is what lets it
 * exist before there is a quote to attach it to. That ordering is the whole
 * reason the object exists: the walkthrough happens first, and forcing capture
 * into the quote would mean nothing can be recorded until pricing has started.
 *
 * The same endpoint serves two sources that feel different and are not — the
 * contractor's own walkthrough, and the photographs a customer sent with an
 * enquiry. An inbound request creates the Job (the Job is the only prerequisite
 * anywhere, and it is created silently by whichever thing comes first) and her
 * files land here. The panel beside the editor cannot tell them apart, and
 * should not have to.
 */

/** Proves the job is this shop's before anything is read or written against it. */
async function requireJob(jobId: string, organizationId: string) {
  const [job] = await db
    .select({ id: jobs.id })
    .from(jobs)
    .where(and(eq(jobs.id, jobId), eq(jobs.organizationId, organizationId)))
    .limit(1);

  if (!job) throw new ApiError("not_found", "That job doesn't exist.");
  return job;
}

export const GET = handlerWithParams<{ id: string }>(async (request, { id }) => {
  const caller = await requireCaller(request);
  const { organizationId } = await requireOrg(request, caller);

  await requireJob(id, organizationId);

  // Signed read URLs, not stored paths — the bucket is private and the panel
  // needs something an `<img>` can actually load.
  return ok(await listCaptures(id, organizationId));
});

export const POST = handlerWithParams<{ id: string }>(
  async (request, { id }) => {
    const caller = await requireCaller(request);
    const { organizationId } = await requireOrg(request, caller);

    await requireJob(id, organizationId);

    const body = await readJson(request, createCaptureSchema);

    if (body.storagePath) {
      // The path has to be this job's, and the file within the per-file limit.
      if (!body.storagePath.startsWith(`${organizationId}/${id}/`)) {
        throw new ApiError("invalid_request", "That file doesn't belong to this job.");
      }
      await assertStoredFileWithinLimit(body.storagePath);
    }

    const [row] = await db
      .insert(captureArtifacts)
      .values({
        jobId: id,
        kind: body.kind,
        body: body.body ?? null,
        // The storage **path**, not a URL. A signed URL expires; the path is
        // what the row has to keep so a new one can be minted on every read.
        fileUrl: body.storagePath ?? null,
        flag: body.flag ?? null,
        capturedAt: body.capturedAt ? new Date(body.capturedAt) : new Date(),
        capturedBy: caller.userId,
      })
      .returning();

    return created(row, `/api/v1/captures/${row.id}`);
  }
);
