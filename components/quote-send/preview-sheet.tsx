"use client";

import { Loader2 } from "lucide-react";

import { DemoChip } from "@/components/demo-chip";
import {
  DocumentFooter,
  DocumentSheet,
} from "@/components/documents/document-sheet";
import {
  QuoteProjection,
  approveLabel,
  signLabel,
} from "@/components/quote/projection";
import {
  ResponsiveDialog,
  ResponsiveDialogBody,
  ResponsiveDialogContent,
  ResponsiveDialogFooter,
  ResponsiveDialogHeader,
} from "@/components/responsive-dialog";
import { ResponsePanel } from "@/components/share/frame";
import { Button } from "@/components/ui/button";
import {
  formatMoney,
  totals,
  unpricedRows,
  type QuoteDraft,
} from "@/lib/quote";
import type { DocumentLook } from "@/lib/branding";
import {
  appliedSignature,
  signsOnQuote,
  type OfficeSignature,
} from "@/lib/signing/lines";

/**
 * Screen 7 · the preview · the only screen serving two people at once.
 *
 * **Her page, exactly as her link draws it.** The same sheet of Letter paper
 * on the same desk, with nothing on the page that wouldn't print — and the
 * button she presses in a panel *under* the sheet, where her link puts it.
 * Nothing inside the document is editable.
 *
 * **The gate is behind the preview.** With no business name, the letterhead
 * shows a gap and the gap is the way to fill it. Send stays live; with the gap
 * it opens the fill instead of refusing. A license is optional and never gates.
 *
 * Beside the page, a short list of what he's about to send, each with a way
 * back to that part of the quote.
 */
export function QuotePreviewSheet({
  open,
  onOpenChange,
  draft,
  office,
  demo,
  preparing,
  onFillHeader,
  onSend,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  draft: QuoteDraft;
  office: {
    businessName: string | null;
    license: string | null;
    phone: string | null;
    logoUrl?: string | null;
    look?: DocumentLook;
    signature?: OfficeSignature | null;
  };
  demo: boolean;
  /** True while the draft is being flushed before the send opens. */
  preparing: boolean;
  onFillHeader: () => void;
  onSend: () => void;
}) {
  const firstName = draft.customerName.trim().split(/\s+/)[0] || "your customer";
  const sums = totals(draft);
  const { exclusions } = unpricedRows(draft);
  const signing = signsOnQuote(draft, office.signature);

  const review = [
    {
      label: "Scope of work",
      value: draft.scopeOfWork.trim() ? "Written" : "Not written yet",
      anchor: "quote.scope",
    },
    { label: "Money", value: formatMoney(sums.totalCents), anchor: "quote.pricing" },
    {
      label: "Terms",
      value:
        sums.depositCents !== null
          ? `${draft.terms.depositPercent}% deposit`
          : "No deposit",
      anchor: "quote.terms",
    },
    {
      label: "Exclusions",
      value: `${exclusions.filter((node) => node.description.trim()).length} stated`,
      anchor: "quote.scope",
    },
  ];

  /** Back to the part of the quote a row names. */
  function edit(anchor: string) {
    onOpenChange(false);
    requestAnimationFrame(() =>
      document
        .querySelector(`[data-tour="${anchor}"]`)
        ?.scrollIntoView({ block: "start" })
    );
  }

  return (
    <ResponsiveDialog open={open} onOpenChange={onOpenChange}>
      <ResponsiveDialogContent desktopClassName="sm:max-w-[min(74rem,calc(100vw-2rem))]">
        <ResponsiveDialogHeader
          title={
            <span className="flex items-center gap-2">
              <span>
                What {demo ? "a customer would see" : `${firstName} sees`}
              </span>
              {demo ? <DemoChip /> : null}
            </span>
          }
          description={`${demo ? "A customer's" : `${capitalize(firstName)}'s`} link as it opens: the page, and under it what they can do.`}
        />

        <ResponsiveDialogBody className="bg-muted dark:bg-muted/40 grid items-start gap-5 p-0 sm:p-6 lg:grid-cols-[minmax(0,1fr)_17rem]">
          {/* The desk: the page, then the panel her link puts under it. */}
          <div className="flex min-w-0 flex-col gap-5 pb-4 sm:pb-0">
            <DocumentSheet
              footer={
                <DocumentFooter
                  businessName={office.businessName}
                  number={draft.number}
                />
              }
            >
              <QuoteProjection
                draft={draft}
                businessName={office.businessName}
                license={office.license}
                phone={office.phone}
                logoUrl={office.logoUrl}
                look={office.look}
                demo={demo}
                onGap={onFillHeader}
                action={null}
                documentLabel="Quote"
                // Her lines as she will see them: the business's signature on
                // its line where the Office applies one, hers still to give.
                signatures={{
                  contractor: appliedSignature(office.signature),
                  customer: null,
                }}
                signaturePrompt={signing ? "Sign below to accept" : null}
              />
            </DocumentSheet>

            {/* What she presses — shown, not pressable, in the preview. */}
            <div className="mx-auto flex w-full max-w-[8.5in] flex-col">
              <ResponsePanel
                title={signing ? "Sign to accept" : "Ready to go ahead?"}
                description={
                  signing
                    ? "No account needed. Sign with a finger, or type your name."
                    : "Approving brings up the contract to sign. No account needed."
                }
              >
                <div
                  aria-hidden
                  className="bg-primary text-primary-foreground flex h-12 items-center justify-center rounded-lg text-base font-medium select-none"
                >
                  {signing ? signLabel(draft) : approveLabel(draft)}
                </div>
              </ResponsePanel>
            </div>
          </div>

          <div className="flex flex-col gap-3 px-4 pb-4 sm:px-0 sm:pb-0 lg:sticky lg:top-24">
            {!office.businessName ? (
              <div className="bg-background flex flex-col gap-2.5 rounded-lg border p-4">
                <p className="text-sm">
                  {demo ? "A customer would see" : `${capitalize(firstName)} sees`}{" "}
                  a blank where your business name goes.
                </p>
                <Button
                  size="sm"
                  variant="outline"
                  className="self-start"
                  onClick={onFillHeader}
                >
                  Add it
                </Button>
              </div>
            ) : null}

            <div className="bg-background rounded-lg border">
              <p className="px-4 pt-3 pb-2 text-sm font-semibold">
                Check before you send
              </p>
              {review.map((row) => (
                <div
                  key={row.label}
                  className="flex items-center justify-between gap-3 border-t px-4 py-2.5 text-sm"
                >
                  <span className="min-w-0">
                    {row.label}
                    <span className="text-muted-foreground"> · {row.value}</span>
                  </span>
                  <Button
                    variant="link"
                    size="sm"
                    className="h-auto p-0"
                    onClick={() => edit(row.anchor)}
                  >
                    Edit
                  </Button>
                </div>
              ))}
            </div>
          </div>
        </ResponsiveDialogBody>

        {/* Pinned, so the primary action never sits below a long document. */}
        <ResponsiveDialogFooter className="flex justify-end gap-2">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Keep editing
          </Button>
          <Button onClick={onSend} disabled={preparing}>
            {preparing ? <Loader2 className="animate-spin" /> : null}
            {/* The next step is the email, so the button says so. */}
            {demo
              ? "Email it to me"
              : firstName === "your customer"
                ? "Email it"
                : `Email it to ${firstName}`}
          </Button>
        </ResponsiveDialogFooter>
      </ResponsiveDialogContent>
    </ResponsiveDialog>
  );
}

function capitalize(value: string) {
  return value.charAt(0).toUpperCase() + value.slice(1);
}
