import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { Plus } from "lucide-react";

import { PageHeader } from "@/components/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
} from "@/components/ui/empty";
import { requireActiveOrganization } from "@/lib/dal";
import { getJobPermits } from "@/lib/queries/permits";
import { formatMoney } from "@/lib/quote";

export const metadata: Metadata = { title: "Permits" };

/**
 * Permits on a job · job L1.
 *
 * Permits nest under the Job because a permit authorizes one piece of work at
 * one address and has no life outside it — which is why there is no top-level
 * `/permits` list. The cross-job question a contractor *does* ask — what is
 * waiting on an inspection — is answered on the dashboard as a gate.
 *
 * The product **tracks** permits; it does not **file** them. Filing means
 * integrating with tens of thousands of authorities with no common interface.
 */
export default async function PermitsPage({
  params,
}: PageProps<"/jobs/[id]/permits">) {
  const org = await requireActiveOrganization();
  const { id } = await params;

  const job = await getJobPermits(id, org.id);
  if (!job) notFound();

  return (
    <div className="mx-auto flex w-full max-w-(--workspace-max-width) flex-col gap-8">
      <PageHeader
        title="Permits"
        description={[job.customerName, job.address].filter(Boolean).join(" — ")}
        actions={
          <Button asChild>
            <Link href={`/jobs/${job.jobId}/permits/new`}>
              <Plus />
              Record a permit
            </Link>
          </Button>
        }
      />

      {job.permits.length === 0 ? (
        <Empty>
          <EmptyHeader>
            <EmptyTitle>No permit on this job</EmptyTitle>
            <EmptyDescription>
              {job.jurisdiction
                ? `Nothing recorded for ${job.jurisdiction} yet. Not every job needs one — "not required" is a real answer worth writing down.`
                : `Nothing recorded yet. Not every job needs one — "not required" is a real answer worth writing down.`}
            </EmptyDescription>
          </EmptyHeader>
          <EmptyContent>
            <Button asChild>
              <Link href={`/jobs/${job.jobId}/permits/new`}>
                Record a permit
              </Link>
            </Button>
          </EmptyContent>
        </Empty>
      ) : (
        job.permits.map((permit) => (
          <Link
            key={permit.id}
            href={`/jobs/${job.jobId}/permits/${permit.id}`}
            className="hover:bg-muted/50 flex items-center justify-between gap-4 rounded-lg border p-4 transition-colors"
          >
            <div className="min-w-0">
              <div className="flex flex-wrap items-baseline gap-2">
                <span className="font-medium">{permit.jurisdiction}</span>
                <Badge variant="secondary" className="capitalize">
                  {permit.status.replace(/_/g, " ")}
                </Badge>
              </div>
              <p className="text-muted-foreground mt-1 text-sm">
                {[
                  permit.type,
                  permit.number ? `#${permit.number}` : null,
                  `pulled by the ${permit.pulledBy}`,
                  permit.feePaidCents !== null
                    ? `fee ${formatMoney(permit.feePaidCents)}`
                    : null,
                ]
                  .filter(Boolean)
                  .join(" · ")}
              </p>
              {permit.inspections.length > 0 ? (
                <p className="text-muted-foreground mt-1 text-xs">
                  {permit.inspections.length} inspection
                  {permit.inspections.length === 1 ? "" : "s"} ·{" "}
                  {permit.inspections.filter((i) => i.result === "passed").length}{" "}
                  passed
                </p>
              ) : null}
            </div>
          </Link>
        ))
      )}
    </div>
  );
}
