import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";

import { CaptureTools } from "@/components/jobs/capture-tools";
import { PageHeader } from "@/components/page-header";
import { CapturePanel } from "@/components/quote-editor/capture-panel";
import { Button } from "@/components/ui/button";
import { requireActiveOrganization } from "@/lib/dal";
import { listCaptures } from "@/lib/queries/captures";
import { getJobHub } from "@/lib/queries/job-hub";

export const metadata: Metadata = { title: "Capture" };

/**
 * Screen 12 · the capture surface.
 *
 * Grab what's in front of you — a photo, a note, a measurement — and it lands
 * on the job straight away, before there is any quote to put it in. The quote
 * editor shows the same captures beside the quote written from them, which is
 * where this page hands off to.
 *
 * The native app's version adds what a browser can't do well: an offline queue
 * for when the signal drops, and recording with a consent step. This page does
 * the part a browser does honestly.
 */
export default async function CapturePage({
  params,
}: PageProps<"/jobs/[id]/capture">) {
  const org = await requireActiveOrganization();
  const { id } = await params;

  const [job, captures] = await Promise.all([
    getJobHub(id, org.id),
    listCaptures(id, org.id),
  ]);
  if (!job) notFound();

  // Straight into the quote this walkthrough is for: the existing one if the
  // job has it, or a new one on this job with the customer already named.
  const quote = job.documents.quoteId
    ? { href: `/quotes/${job.documents.quoteId}`, label: "Open the quote" }
    : {
        href: `/quotes/new?job=${job.id}&customer=${job.customerId}`,
        label: "Start the quote",
      };

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-8">
      <PageHeader
        title="Walkthrough capture"
        description={[job.customerName, job.name].filter(Boolean).join(" — ")}
        actions={
          <>
            <Button asChild variant="ghost">
              <Link href={`/jobs/${job.id}`}>Back to the job</Link>
            </Button>
            <Button asChild variant="outline">
              <Link href={quote.href}>{quote.label}</Link>
            </Button>
          </>
        }
      />

      <CaptureTools jobId={job.id} />

      {captures.length > 0 ? (
        <CapturePanel captures={captures} className="rounded-lg border" />
      ) : (
        <p className="text-muted-foreground border-t pt-4 text-sm">
          Nothing captured on this job yet.
        </p>
      )}
    </div>
  );
}
