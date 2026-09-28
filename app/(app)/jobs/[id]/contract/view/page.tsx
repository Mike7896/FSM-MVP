import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import type { Metadata } from "next";

import { PenLine } from "lucide-react";

import {
  DocumentDesk,
  DocumentFooter,
  DocumentSheet,
} from "@/components/documents/document-sheet";
import { inkFor } from "@/components/documents/ink";
import { ContractModeSwitch } from "@/components/documents/mode-switch";
import { PrintButton } from "@/components/documents/print-button";
import { QuoteProjection } from "@/components/quote/projection";
import { SignBlock } from "@/components/signing/sign-block";
import { Button } from "@/components/ui/button";
import { getCurrentUser, requireActiveOrganization } from "@/lib/dal";
import {
  getContractPaper,
  getJobContract,
  type ContractView,
} from "@/lib/queries/contracts";
import { formatMoney } from "@/lib/quote";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "Contract" };

/**
 * The contract as a document — the sheet of paper both of you signed.
 *
 * **The paper and nothing else on it.** Where it stands — who has signed, who
 * has opened it, the deposit, the changes — lives on the contract's overview,
 * an ordinary screen; this is the thing itself, at its own size, for reading
 * it back, signing it, and printing a copy. It is the same sheet the customer
 * opens on their link, drawn by the same builder, so the two cannot disagree.
 *
 * Nobody edits a Contract: everything after it moves through a change order,
 * which is why amendments are listed beneath with the original still intact.
 */
export default async function ContractDocumentPage({
  params,
}: PageProps<"/jobs/[id]/contract/view">) {
  const org = await requireActiveOrganization();
  const { id } = await params;

  const contract = await getJobContract(id, org.id);
  // Nothing agreed yet: the overview says so, and says what comes first.
  if (!contract) redirect(`/jobs/${id}/contract`);

  const signed = contract.customerSignedAt !== null;
  // The business signs first. The customer's link can't take a signature
  // until it has, so an unsigned business line is what's holding the job up.
  const awaitingYou = contract.contractorSignedAt === null;
  const [paper, profile] = await Promise.all([
    getContractPaper(contract.id, org.id),
    awaitingYou ? getCurrentUser() : Promise.resolve(null),
  ]);
  if (!paper) notFound();

  const standing = signed
    ? {
        tone: "bg-emerald-500",
        text: `Signed by you and ${contract.customerName} · ${day(contract.customerSignedAt!)}`,
      }
    : awaitingYou
      ? { tone: "bg-amber-500", text: "Waiting on your signature" }
      : {
          tone: "bg-sky-500",
          text: `Waiting on ${contract.customerName}'s signature`,
        };

  return (
    <div className="-m-4 flex min-h-0 flex-1 flex-col md:-m-6">
      {/* The app's furniture, and none of it prints. */}
      <div
        data-print="hide"
        className="bg-background flex flex-wrap items-center justify-between gap-3 border-b px-4 py-3 md:px-6"
      >
        <div className="min-w-0">
          <p className="text-sm font-medium">
            {paper.draft.number ?? "Contract"}
            {paper.draft.title ? ` · ${paper.draft.title}` : ""}
          </p>
          <p className="text-muted-foreground flex flex-wrap items-center gap-x-1.5 text-xs">
            <span className={cn("size-1.5 rounded-full", standing.tone)} />
            {standing.text}
            {contract.sourceQuoteId && contract.sourceQuoteNumber ? (
              <>
                <span aria-hidden>·</span>
                <Link
                  href={`/quotes/${contract.sourceQuoteId}/view`}
                  className="hover:text-foreground underline underline-offset-2"
                >
                  from quote {contract.sourceQuoteNumber}
                </Link>
              </>
            ) : null}
          </p>
        </div>
        <div className="flex shrink-0 flex-wrap items-center gap-2">
          {awaitingYou ? (
            <Button asChild>
              <a href="#sign">
                <PenLine />
                Sign it
              </a>
            </Button>
          ) : null}
          <ContractModeSwitch mode="document" jobId={id} />
          <PrintButton />
        </div>
      </div>

      <DocumentDesk className="flex-1">
        <div className="flex w-full max-w-[8.5in] flex-col gap-6">
          {/* **The contract as signed, and nothing else on it.** Amendments
              are their own documents, below — nobody edits a contract, so the
              page stays exactly what the two of you put your names to. */}
          <DocumentSheet
            footer={
              <DocumentFooter
                businessName={paper.office.businessName}
                number={paper.draft.number}
              />
            }
          >
            <QuoteProjection
              draft={paper.draft}
              businessName={paper.office.businessName}
              license={paper.office.license}
              phone={paper.office.phone}
              logoUrl={paper.office.logoUrl}
              action={null}
              documentLabel="Contract"
              signatureBlock
              signatures={paper.signatures}
            />
          </DocumentSheet>

          {awaitingYou ? (
            <div id="sign" data-print="hide" className="scroll-mt-6">
              <SignBlock
                endpoint={`/api/v1/documents/${contract.id}/sign`}
                party="contractor"
                defaultName={profile?.fullName ?? null}
                businessName={contract.businessName}
                actionLabel="Sign for the business"
                heading="Sign for the business"
                description={`${contract.customerName} can sign as soon as you have. Draw it, or type your name — both count.`}
              />
            </div>
          ) : null}

          {contract.changeOrders.length > 0 ? (
            <Amendments
              jobId={id}
              agreedCents={contract.agreedPriceCents}
              currentCents={contract.currentPriceCents}
              orders={contract.changeOrders}
            />
          ) : null}
        </div>
      </DocumentDesk>
    </div>
  );
}

/**
 * The change orders that amend it, beneath the contract rather than written
 * into it — the original stays readable above, which is the whole point of
 * never editing one.
 */
function Amendments({
  jobId,
  agreedCents,
  currentCents,
  orders,
}: {
  jobId: string;
  agreedCents: number;
  currentCents: number;
  orders: ContractView["changeOrders"];
}) {
  return (
    <section data-print="hide" className="bg-background rounded-lg border">
      <div className="flex flex-wrap items-baseline justify-between gap-2 border-b px-4 py-3">
        <p className="flex items-center gap-2 text-sm font-medium">
          <span className={cn("size-1.5 rounded-full", inkFor("Change order").dot)} />
          Amended by {orders.length} change{" "}
          {orders.length === 1 ? "order" : "orders"}
        </p>
        <p className="text-muted-foreground text-xs tabular-nums">
          {currentCents === agreedCents ? (
            <>Price unchanged at {formatMoney(agreedCents)}</>
          ) : (
            <>
              {formatMoney(agreedCents)} as signed →{" "}
              <span className="text-foreground font-medium">
                {formatMoney(currentCents)}
              </span>{" "}
              with approved changes
            </>
          )}
        </p>
      </div>
      <ol>
        {orders.map((order) => (
          <li key={order.id} className="border-t first:border-t-0">
            <Link
              href={`/jobs/${jobId}/change-orders/${order.id}`}
              className="hover:bg-muted/50 flex items-baseline justify-between gap-4 px-4 py-3 transition-colors"
            >
              <span className="min-w-0">
                <span className="text-sm">
                  {order.number} · {order.whatChanged ?? "No description"}
                </span>
                <span className="text-muted-foreground block text-xs capitalize">
                  {order.status.replace(/_/g, " ")}
                </span>
              </span>
              <span className="shrink-0 text-sm font-medium tabular-nums">
                {order.priceDeltaCents >= 0 ? "+" : "−"}
                {formatMoney(Math.abs(order.priceDeltaCents))}
              </span>
            </Link>
          </li>
        ))}
      </ol>
    </section>
  );
}

function day(date: Date) {
  return date.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}
