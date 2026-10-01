import { and, eq } from "drizzle-orm";

import { requireCaller, requireOrg } from "@/lib/api/auth";
import { handlerWithParams, readJson } from "@/lib/api/handler";
import { ApiError, ok } from "@/lib/api/response";
import { db } from "@/lib/db";
import { jobs } from "@/lib/db/schema";
import { assertCanStoreAttachment } from "@/lib/membership/storage";
import { captureUploadSchema } from "@/lib/schemas";
import {
  BUCKETS,
  createSignedUploadUrl,
  jobAttachmentPath,
} from "@/lib/supabase/storage";

/**
 * `/api/v1/jobs/[id]/captures/upload` — somewhere to put the file.
 *
 * **The browser uploads straight to Storage.** A walkthrough's photographs run
 * to tens of megabytes and routing them through a Next server buys nothing but
 * a timeout; a short-lived signed URL puts the bytes where they are going in
 * one hop.
 *
 * The path is `<organizationId>/<jobId>/<uuid>-<name>` and the organization
 * segment is **built here from the id `requireOrg` proved**, never from
 * anything the caller sent. The bucket's own RLS policy checks that first
 * segment against membership, so a path assembled on the client would be a path
 * that could name another shop's folder.
 *
 * Nothing is written to the database by this call. The row is created after the
 * upload lands, by `POST /captures` — a row written first is a thumbnail that
 * never loads, and the panel is a record of a walkthrough rather than a list of
 * intentions.
 */
export const POST = handlerWithParams<{ id: string }>(
  async (request, { id }) => {
    const caller = await requireCaller(request);
    const { organizationId } = await requireOrg(request, caller);

    const [job] = await db
      .select({ id: jobs.id })
      .from(jobs)
      .where(and(eq(jobs.id, id), eq(jobs.organizationId, organizationId)))
      .limit(1);

    if (!job) throw new ApiError("not_found", "That job doesn't exist.");

    const { fileName } = await readJson(request, captureUploadSchema);

    // A full attachment allowance stops new files and nothing else (Billing §2.2).
    await assertCanStoreAttachment(organizationId);

    const path = jobAttachmentPath(organizationId, id, fileName);
    const signed = await createSignedUploadUrl(BUCKETS.jobAttachments, path);

    return ok({
      path: signed.path,
      signedUrl: signed.signedUrl,
      token: signed.token,
    });
  }
);
