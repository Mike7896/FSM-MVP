import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import type { Metadata } from "next";

import { PrintButton } from "@/components/documents/print-button";
import { SignatureCertificate } from "@/components/signing/signature-certificate";
import { Button } from "@/components/ui/button";
import { requireActiveOrganization } from "@/lib/dal";
import { getJobContract } from "@/lib/queries/contracts";
import { certificateFor } from "@/lib/signing/certificate";

export const metadata: Metadata = { title: "Signing record" };

/**
 * The contract's signing record — the certificate of completion.
 *
 * **The page that does the work in a dispute.** Seven months on, an adjuster or
 * a card issuer's analyst asks who signed, when, from where, whether they
 * agreed to sign electronically, and whether the document changed afterwards.
 * This answers all of it on one printable page, recomputed from the document
 * as it stands rather than read back from a stored "verified".
 */
export default async function ContractCertificatePage({
  params,
}: PageProps<"/jobs/[id]/contract/certificate">) {
  const org = await requireActiveOrganization();
  const { id } = await params;

  const contract = await getJobContract(id, org.id);
  if (!contract) redirect(`/jobs/${id}/contract`);

  const certificate = await certificateFor(contract.id, org.id);
  if (!certificate) notFound();

  return (
    <div className="flex flex-col gap-8">
      <div
        data-print="hide"
        className="mx-auto flex w-full max-w-2xl flex-wrap items-center justify-between gap-2"
      >
        <Button asChild variant="ghost" size="sm" className="-ml-3">
          <Link href={`/jobs/${id}/contract`}>← Back to the contract</Link>
        </Button>
        <PrintButton />
      </div>
      <SignatureCertificate certificate={certificate} />
    </div>
  );
}
