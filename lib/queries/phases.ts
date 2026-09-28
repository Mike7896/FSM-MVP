import "server-only";

import { asc, eq, inArray } from "drizzle-orm";

import { db } from "@/lib/db";
import { captureArtifacts, evidence, evidencePhotos } from "@/lib/db/schema";
import { getJobHub, type JobHub, type StageRow } from "@/lib/queries/job-hub";
import { BUCKETS, createSignedDownloadUrl } from "@/lib/supabase/storage";

/**
 * A job's phases with the proof behind each one — what `/jobs/[id]/complete`
 * and `GET /api/v1/jobs/[id]/phases` both read.
 *
 * **The phases and their state come from the job hub**, so a phase reads
 * "ready" or "billed" identically on every surface. This adds the one thing the
 * hub doesn't carry: the write-up and photos recorded when a phase was marked
 * complete.
 */

export type PhaseEvidence = {
  id: string;
  summary: string | null;
  /** ISO string — this crosses to a Client Component. */
  completedAt: string | null;
  /** The captures this was assembled from, so an edit starts from them. */
  captureIds: string[];
  photos: { id: string; url: string | null; caption: string | null }[];
};

export type PhaseView = StageRow & { evidence: PhaseEvidence | null };

export type JobPhases = {
  job: Pick<
    JobHub,
    "id" | "number" | "name" | "customerName" | "status" | "money"
  >;
  phases: PhaseView[];
};

export async function getJobPhases(
  jobId: string,
  organizationId: string
): Promise<JobPhases | null> {
  const hub = await getJobHub(jobId, organizationId);
  if (!hub) return null;

  const records = await db
    .select()
    .from(evidence)
    .where(eq(evidence.jobId, jobId))
    .orderBy(asc(evidence.createdAt));

  const ids = records.map((row) => row.id);

  const [photos, sources] = await Promise.all([
    ids.length
      ? db
          .select()
          .from(evidencePhotos)
          .where(inArray(evidencePhotos.evidenceId, ids))
          .orderBy(asc(evidencePhotos.position))
      : Promise.resolve([]),
    ids.length
      ? db
          .select({
            id: captureArtifacts.id,
            evidenceId: captureArtifacts.promotedToEvidenceId,
          })
          .from(captureArtifacts)
          .where(inArray(captureArtifacts.promotedToEvidenceId, ids))
      : Promise.resolve([]),
  ]);

  // The bucket is private: the row keeps the path, and a read URL is minted
  // per view and expires.
  const urls = new Map(
    await Promise.all(
      photos.map(
        async (photo) => [photo.id, await signQuietly(photo.fileUrl)] as const
      )
    )
  );

  function view(record: (typeof records)[number]): PhaseEvidence {
    return {
      id: record.id,
      summary: record.summary,
      completedAt: record.completedAt?.toISOString() ?? null,
      captureIds: sources
        .filter((source) => source.evidenceId === record.id)
        .map((source) => source.id),
      photos: photos
        .filter((photo) => photo.evidenceId === record.id)
        .map((photo) => ({
          id: photo.id,
          url: urls.get(photo.id) ?? null,
          caption: photo.caption,
        })),
    };
  }

  const phases = hub.stages.map((stage): PhaseView => {
    const forPhase = records.filter(
      (row) =>
        row.drawScheduleId === stage.id ||
        // Evidence recorded before phases had ids is matched by name.
        (row.drawScheduleId === null &&
          row.phaseName.trim().toLowerCase() ===
            stage.name.trim().toLowerCase())
    );

    // Billed: only the proof that went out with the bill — a later write-up
    // was never shown to the customer. Otherwise the latest.
    const match = stage.invoiceId
      ? forPhase.find((row) => row.invoiceId === stage.invoiceId)
      : [...forPhase].reverse().find((row) => row.invoiceId === null);

    return { ...stage, evidence: match ? view(match) : null };
  });

  return {
    job: {
      id: hub.id,
      number: hub.number,
      name: hub.name,
      customerName: hub.customerName,
      status: hub.status,
      money: hub.money,
    },
    phases,
  };
}

/** A photo that won't sign is a missing thumbnail, not a broken page. */
async function signQuietly(path: string): Promise<string | null> {
  try {
    return await createSignedDownloadUrl(BUCKETS.jobAttachments, path);
  } catch {
    return null;
  }
}
