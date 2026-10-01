import { notFound } from "next/navigation";
import type { Metadata } from "next";

import { InvoiceEditor } from "@/components/invoice-editor";
import { PageHeader } from "@/components/page-header";
import { requireActiveOrganization } from "@/lib/dal";
import { getJobContract } from "@/lib/queries/contracts";
import { getJobHub } from "@/lib/queries/job-hub";

export const metadata: Metadata = { title: "Bill this job" };

/**
 * `/jobs/[id]/invoices/new` — *bill this job*, reached from the job hub with the
 * contract's math already applied. It sits alongside `/invoices/new`, which is
 * *bill somebody*, reached cold. Same object, two doors: the nested route
 * writes to a known Job's timeline, the top-level one creates the Job it will
 * write to.
 *
 * `?stage=` names a row on the draw schedule, which is how the hub's primary
 * action arrives here with the amount already agreed rather than asking the
 * contractor to invent one.
 */
export default async function BillJobPage({
  params,
  searchParams,
}: PageProps<"/jobs/[id]/invoices/new">) {
  const org = await requireActiveOrganization();
  const [{ id }, { stage }] = await Promise.all([params, searchParams]);

  const [job, contract] = await Promise.all([
    getJobHub(id, org.id),
    getJobContract(id, org.id),
  ]);

  if (!job) notFound();

  const stageId = typeof stage === "string" ? stage : undefined;
  const billing =
    job.stages.find((row) => row.id === stageId) ??
    job.stages.find((row) => row.state === "ready");

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-10">
      <PageHeader
        title="Bill this job"
        description={[job.customerName, job.name].filter(Boolean).join(" — ")}
      />
      <InvoiceEditor
        jobId={job.id}
        customerName={job.customerName}
        stage={
          billing
            ? {
                id: billing.id,
                name: billing.name,
                amountCents: billing.amountCents,
                gate: billing.gate,
                evidenceReady: billing.evidenceReady,
              }
            : null
        }
        contract={
          contract
            ? {
                id: contract.id,
                // Invoices source from the Contract, never the Quote: the
                // current price already includes every approved change order,
                // which is what stops one being silently dropped from a bill.
                agreedCents: contract.currentPriceCents,
                billedCents: job.money.billedCents,
                collectedCents: job.money.collectedCents,
              }
            : null
        }
      />
    </div>
  );
}
