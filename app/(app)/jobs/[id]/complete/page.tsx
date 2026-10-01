import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";

import { PhaseComplete } from "@/components/jobs/phase-complete";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { requireActiveOrganization } from "@/lib/dal";
import { listCaptures } from "@/lib/queries/captures";
import { getJobPhases } from "@/lib/queries/phases";

export const metadata: Metadata = { title: "Mark a phase complete" };

/**
 * `/jobs/[id]/complete` — Screen 18, the phase-complete evidence flow.
 *
 * **Every phase on this page is the job's own**, read from its plan. A job with
 * no plan gets no invented phases: it gets the way to make one, on the job's
 * money page, where "how this job gets paid" lives.
 *
 * `?phase=` opens one directly, which is how the job hub's "Mark it complete"
 * arrives with the right phase already in front of him.
 */
export default async function PhaseCompletePage({
  params,
  searchParams,
}: PageProps<"/jobs/[id]/complete">) {
  const org = await requireActiveOrganization();
  const [{ id }, { phase }] = await Promise.all([params, searchParams]);

  const [view, captures] = await Promise.all([
    getJobPhases(id, org.id),
    listCaptures(id, org.id),
  ]);

  if (!view) notFound();

  const photos = captures.flatMap((capture) =>
    capture.kind === "photo" && capture.fileUrl
      ? [
          {
            id: capture.id,
            url: capture.fileUrl,
            caption: capture.body,
            promotedToEvidenceId: capture.promotedToEvidenceId,
          },
        ]
      : []
  );

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-8">
      <PageHeader
        title="Mark a phase complete"
        description={[view.job.customerName, view.job.name]
          .filter(Boolean)
          .join(" — ")}
      />

      {view.phases.length === 0 ? (
        <section className="flex flex-col gap-3 rounded-xl border p-5">
          <p className="font-medium">No phases planned for this job yet</p>
          <p className="text-muted-foreground text-sm">
            Phases are how this job&apos;s money comes in as the work moves — a
            deposit, a draw as each phase finishes, and the final balance. Plan
            them once, then mark each one complete here.
          </p>
          <Button asChild size="sm" className="self-start">
            <Link href={`/jobs/${id}/money#phases`}>Plan the phases</Link>
          </Button>
        </section>
      ) : (
        <PhaseComplete
          jobId={view.job.id}
          phases={view.phases}
          photos={photos}
          initialPhaseId={typeof phase === "string" ? phase : undefined}
        />
      )}
    </div>
  );
}
