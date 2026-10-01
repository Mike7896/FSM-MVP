import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";

import { ChangeOrderEditor } from "@/components/change-orders/editor";
import { Button } from "@/components/ui/button";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
} from "@/components/ui/empty";
import { getCurrentUser, requireActiveOrganization } from "@/lib/dal";
import { getJobContract } from "@/lib/queries/contracts";
import { getJobHub } from "@/lib/queries/job-hub";
import { getOfficeIdentity, getOfficeSignature } from "@/lib/queries/office";
import { emptyDraft } from "@/lib/quote";
import { listChangeRequests } from "@/lib/change-orders/requests";
import { agreedChangeTargets } from "@/lib/change-orders/service";
import { listCaptures } from "@/lib/queries/captures";

export const metadata: Metadata = { title: "Change order" };

/**
 * The editor in delta mode · Flow 8, job R1.
 *
 * **Change order is the one document with no standalone create path, and that
 * is correct rather than a gap.** It is *defined* as a delta against an agreed
 * document — `parent_contract_id` is NOT NULL for that reason — so a contractor
 * with no contract who needs to price added work is writing a Quote, which is
 * exactly what the empty state says.
 *
 * The delta is measured against the contract's **current** price, approved
 * amendments included. Measuring against the original would let the second
 * change order quietly undo the first.
 */
export default async function NewChangeOrderPage({
  params,
  searchParams,
}: PageProps<"/jobs/[id]/change-orders/new">) {
  const org = await requireActiveOrganization();
  const { id } = await params;
  const query = await searchParams;
  const requested = typeof query.request === "string" ? (await listChangeRequests(id, org.id)).find(r => r.id === query.request) : undefined;

  const [job, contract, office] = await Promise.all([
    getJobHub(id, org.id),
    getJobContract(id, org.id),
    // The Header section is a lookup, and it looks up here. The shop supplies
    // the document; nothing on this page ever writes back.
    getOfficeIdentity(org.id),
  ]);

  if (!job) notFound();

  // Nothing agreed means nothing to amend. Stated as a redirection rather than
  // an error, because writing a quote is the right answer here.
  if (!contract || contract.status !== "signed") {
    return (
      <div className="mx-auto flex w-full max-w-lg flex-col gap-8">
        <Empty>
          <EmptyHeader>
            <EmptyTitle>There is no contract on this job yet.</EmptyTitle>
            <EmptyDescription>
              A change order changes what you already agreed to. With nothing
              agreed, the work you are pricing is just a quote.
            </EmptyDescription>
          </EmptyHeader>
          <EmptyContent className="gap-3">
            <Button asChild>
              <Link href={`/quotes/new?job=${job.id}`}>
                Write a quote instead
              </Link>
            </Button>
            <Link
              href={`/jobs/${job.id}/contract`}
              className="text-primary-ink text-sm underline underline-offset-4"
            >
              Send a contract for this job first
            </Link>
          </EmptyContent>
        </Empty>
      </div>
    );
  }

  const [captures, targets, signature, profile] = await Promise.all([
    listCaptures(job.id, org.id),
    agreedChangeTargets(contract.id, org.id),
    getOfficeSignature(org.id),
    getCurrentUser(),
  ]);

  return (
    // Full bleed inside the shell, like the quote editor: the editor draws its
    // own bar and columns, and they meet the edges of the content region.
    <div className="-m-4 flex min-h-0 flex-1 flex-col md:-m-6">
      <ChangeOrderEditor
        captures={captures}
        targets={targets}
        office={office}
        initial={emptyDraft({ jobId: job.id, customerName: job.customerName, title: job.name ?? "", scopeOfWork: requested?.body ?? "" })}
        requestId={requested?.id}
        parentContractId={contract.id}
        agreedPriceCents={contract.currentPriceCents}
        contractNumber={contract.number}
        signerName={signature?.printedName ?? profile?.fullName ?? null}
        customerEmail={contract.customerEmail}
      />
    </div>
  );
}
