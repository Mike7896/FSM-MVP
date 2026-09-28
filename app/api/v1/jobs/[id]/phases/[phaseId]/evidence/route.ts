import { and, desc, eq, inArray, isNull } from "drizzle-orm";

import { requireCaller, requireOrg } from "@/lib/api/auth";
import { handlerWithParams, readJson } from "@/lib/api/handler";
import { ApiError, ok } from "@/lib/api/response";
import { db } from "@/lib/db";
import {
  captureArtifacts,
  drawSchedule,
  evidence,
  evidencePhotos,
  jobs,
} from "@/lib/db/schema";
import { getJobPhases } from "@/lib/queries/phases";
import { recordEvidenceSchema } from "@/lib/schemas";

/**
 * `POST /api/v1/jobs/[id]/phases/[phaseId]/evidence` — mark a phase complete.
 *
 * **The proof, not the bill.** A write-up and photos from this job's captures,
 * recorded against the phase they prove. Billing is its own step
 * (`POST /api/v1/invoices` with the phase), so a contractor can mark rough-in
 * done on Tuesday and bill it Friday — and the proof travels with the bill when
 * it goes.
 *
 * Sending it again before the phase is billed replaces the write-up and the
 * photos rather than piling up a second record. Once billed, it's locked: the
 * customer has seen it.
 *
 * A photo can be proof for one phase only. It's the same picture either way,
 * but the capture delete guard keys on that link, and a photo the customer was
 * shown for money must not become deletable because it was reused.
 */
export const POST = handlerWithParams<{ id: string; phaseId: string }>(
  async (request, { id, phaseId }) => {
    const caller = await requireCaller(request);
    const { organizationId } = await requireOrg(request, caller);

    const [row] = await db
      .select({ phase: drawSchedule })
      .from(drawSchedule)
      .innerJoin(jobs, eq(drawSchedule.jobId, jobs.id))
      .where(
        and(
          eq(drawSchedule.id, phaseId),
          eq(drawSchedule.jobId, id),
          eq(jobs.organizationId, organizationId)
        )
      )
      .limit(1);

    if (!row) throw new ApiError("not_found", "That phase isn't on this job.");
    const { phase } = row;

    if (phase.gate === "on_acceptance") {
      throw new ApiError(
        "invalid_request",
        "A deposit is due when the customer accepts — there's no phase to mark complete."
      );
    }
    if (phase.invoiceId) {
      throw new ApiError(
        "conflict",
        `${phase.name} is already billed. Its proof went out with the bill.`
      );
    }

    const body = await readJson(request, recordEvidenceSchema);

    const [current] = await db
      .select({ id: evidence.id })
      .from(evidence)
      .where(and(eq(evidence.drawScheduleId, phaseId), isNull(evidence.invoiceId)))
      .orderBy(desc(evidence.createdAt))
      .limit(1);

    const wanted = [...new Set(body.captureIds)];
    const photos = wanted.length
      ? await db
          .select({
            id: captureArtifacts.id,
            kind: captureArtifacts.kind,
            fileUrl: captureArtifacts.fileUrl,
            caption: captureArtifacts.body,
            promotedToEvidenceId: captureArtifacts.promotedToEvidenceId,
          })
          .from(captureArtifacts)
          .where(
            and(eq(captureArtifacts.jobId, id), inArray(captureArtifacts.id, wanted))
          )
      : [];

    if (
      photos.length !== wanted.length ||
      photos.some((photo) => photo.kind !== "photo" || !photo.fileUrl)
    ) {
      throw new ApiError(
        "invalid_request",
        "Some of those photos aren't on this job.",
        [{ field: "captureIds", message: "Some of those photos aren't on this job." }]
      );
    }

    if (
      photos.some(
        (photo) =>
          photo.promotedToEvidenceId !== null &&
          photo.promotedToEvidenceId !== current?.id
      )
    ) {
      throw new ApiError(
        "conflict",
        "One of those photos is already proof for another phase. Pick a different one."
      );
    }

    await db.transaction(async (tx) => {
      let evidenceId: string;

      if (current) {
        await tx
          .update(evidence)
          .set({
            summary: body.summary,
            phaseName: phase.name,
            completedAt: new Date(),
          })
          .where(eq(evidence.id, current.id));
        await tx
          .delete(evidencePhotos)
          .where(eq(evidencePhotos.evidenceId, current.id));
        await tx
          .update(captureArtifacts)
          .set({ promotedToEvidenceId: null })
          .where(eq(captureArtifacts.promotedToEvidenceId, current.id));
        evidenceId = current.id;
      } else {
        const [created] = await tx
          .insert(evidence)
          .values({
            jobId: id,
            drawScheduleId: phaseId,
            // Kept for the surfaces that still read the name.
            phaseName: phase.name,
            summary: body.summary,
            completedAt: new Date(),
          })
          .returning({ id: evidence.id });
        evidenceId = created.id;
      }

      if (photos.length) {
        const order = new Map(wanted.map((captureId, index) => [captureId, index]));
        await tx.insert(evidencePhotos).values(
          photos.map((photo) => ({
            evidenceId,
            fileUrl: photo.fileUrl!,
            caption: photo.caption,
            position: order.get(photo.id) ?? 0,
          }))
        );
        await tx
          .update(captureArtifacts)
          .set({ promotedToEvidenceId: evidenceId })
          .where(inArray(captureArtifacts.id, wanted));
      }
    });

    return ok(await getJobPhases(id, organizationId));
  }
);
