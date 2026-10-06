import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";

import {
  DocumentDesk,
  DocumentFooter,
  DocumentSheet,
} from "@/components/documents/document-sheet";
import { DocumentModeSwitch, StandingLink } from "@/components/documents/mode-switch";
import { PrintButton } from "@/components/documents/print-button";
import { PrintBoundary } from "@/components/documents/print-boundary";
import { isJobActivated } from "@/lib/membership/activation";
import { getAccess } from "@/lib/membership/access";
import { QuoteProjection } from "@/components/quote/projection";
import { Button } from "@/components/ui/button";
import { requireActiveOrganization } from "@/lib/dal";
import { draftFromRecord } from "@/lib/quote";
import { getOfficeIdentity, getOfficeSignature } from "@/lib/queries/office";
import { getQuote } from "@/lib/queries/quotes";
import { quoteSignatures } from "@/lib/queries/signatures";

export const metadata: Metadata = { title: "Quote" };

/**
 * A quote in **view** mode — the document, rather than the workbench.
 *
 * **One quote, two modes.** Edit is where it gets written; View is the thing
 * being written, at its own size with nothing of the app drawn on it — for
 * reading it back before a phone call, or printing a copy for a permit
 * office. Same object, same address but for the last segment, and the switch
 * sits in the same place in both.
 *
 * **It is the same sheet the customer opens and the same sheet that prints.**
 * One component, so the three can never disagree — and when a server-rendered
 * PDF lands, it renders this too.
 *
 * The approve button is deliberately absent: this is the contractor's copy,
 * and a button he cannot press is furniture. The customer's own link keeps it.
 */
export default async function QuoteDocumentPage({
  params,
}: PageProps<"/quotes/[id]/view">) {
  const org = await requireActiveOrganization();
  const { id } = await params;

  const [record, office, stored, { features }] = await Promise.all([
    getQuote(id, org.id),
    getOfficeIdentity(org.id),
    getOfficeSignature(org.id),
    getAccess(org.id),
  ]);
  if (!record) notFound();
  const requiresActivation = features.monthlyActivations !== null && !(await isJobActivated(record.jobId));

  // The lines as they stand: recorded once accepted, the stored signature on
  // the business's line before that. A printed copy keeps her line blank for
  // a pen.
  const signatures = record.signatureLines
    ? await quoteSignatures(record.id, org.id, stored)
    : undefined;

  return (
    // Out to the edges of the content area — the layout pads it px-4 py-6,
    // md:px-8 md:py-8 — so the desk runs up to the sidebar with no white rim.
    <PrintBoundary requiresActivation={requiresActivation}>
    <div className="-mx-4 -my-6 flex min-h-0 flex-1 flex-col md:-mx-8 md:-my-8">
      {/* The app's furniture, and none of it prints. */}
      <div
        data-print="hide"
        className="bg-background flex flex-wrap items-center justify-between gap-3 border-b px-4 py-3 md:px-8"
      >
        <div className="min-w-0">
          <p className="text-sm font-medium">
            {record.number ?? "Quote"}
            {record.title ? ` · ${record.title}` : ""}
          </p>
          <p className="text-muted-foreground text-xs">
            How it reads on paper — and what prints.
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <StandingLink quoteId={record.id} status={record.status} />
          <DocumentModeSwitch
            mode="view"
            viewHref={`/quotes/${record.id}/view`}
            editHref={`/quotes/${record.id}`}
          />
          <PrintButton jobId={record.jobId} />
          <Button asChild variant="ghost" size="sm">
            <Link href="/quotes">All quotes</Link>
          </Button>
        </div>
      </div>

      <DocumentDesk className="flex-1">
        <DocumentSheet
          footer={
            <DocumentFooter
              businessName={office.businessName}
              number={record.number}
              promo={features.promoFooter}
            />
          }
        >
          <QuoteProjection
            draft={draftFromRecord(record)}
            businessName={office.businessName}
            license={office.license}
            phone={office.phone}
            logoUrl={features.branding ? office.logoUrl : null}
            action={null}
            documentLabel="Quote"
            signatures={signatures}
          />
        </DocumentSheet>
      </DocumentDesk>
    </div>
    </PrintBoundary>
  );
}
