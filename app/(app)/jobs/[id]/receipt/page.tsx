import { notFound } from "next/navigation";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/page-header";
import { ReceiptForm } from "@/components/jobs/receipt-form";
import { requireActiveOrganization } from "@/lib/dal";
import { getJobHub } from "@/lib/queries/job-hub";

export const metadata = { title: "Add a receipt" };
export default async function ReceiptPage({ params }: PageProps<"/jobs/[id]/receipt">) {
  const org = await requireActiveOrganization();
  const { id } = await params;
  const job = await getJobHub(id, org.id);
  if (!job) notFound();
  return <div className="mx-auto flex w-full max-w-2xl flex-col gap-8">
    <PageHeader title="Add a receipt" description={[job.customerName, job.name].filter(Boolean).join(" — ")} actions={<Button asChild variant="ghost"><Link href={`/jobs/${id}#receipts`}>Back to the job</Link></Button>} />
    <ReceiptForm jobId={id} />
  </div>;
}
