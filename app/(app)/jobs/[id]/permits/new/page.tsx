import { notFound } from "next/navigation";
import { PageHeader } from "@/components/page-header";
import { PermitForm } from "@/components/jobs/permit-form";
import { requireActiveOrganization } from "@/lib/dal";
import { getJobPermits } from "@/lib/queries/permits";
export const metadata = { title: "Record a permit" };
export default async function NewPermitPage({ params }: PageProps<"/jobs/[id]/permits/new">) {
  const org = await requireActiveOrganization();
  const { id } = await params;
  const job = await getJobPermits(id, org.id);
  if (!job) notFound();
  return <div className="mx-auto flex w-full max-w-2xl flex-col gap-8">
    <PageHeader title="Record a permit" description={[job.customerName, job.address].filter(Boolean).join(" — ")} />
    <PermitForm jobId={id} initial={{ jurisdiction: job.jurisdiction ?? "" }} />
  </div>;
}
