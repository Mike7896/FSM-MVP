"use client";

import { Loader2 } from "lucide-react";

import { DemoChip } from "@/components/demo-chip";
import {
  DocumentFooter,
  DocumentSheet,
} from "@/components/documents/document-sheet";
import { QuoteProjection } from "@/components/quote/projection";
import {
  ResponsiveDialog,
  ResponsiveDialogBody,
  ResponsiveDialogContent,
  ResponsiveDialogFooter,
  ResponsiveDialogHeader,
} from "@/components/responsive-dialog";
import { Button } from "@/components/ui/button";
import {
  formatMoney,
  totals,
  unpricedRows,
  type QuoteDraft,
} from "@/lib/quote";
import {
  appliedSignature,
  signsOnQuote,
  type OfficeSignature,
} from "@/lib/signing/lines";

/**
 * Screen 7 · the preview · the only screen serving two people at once.
 *
 * **Her page, not his.** The live share projection, capped at phone width
 * because she is always on a phone, with his controls outside the frame. Nothing
 * inside the document is editable — mixing edit affordances into the customer's
 * view is how it stops reading as hers.
 *
 * **The gate is behind the preview.** On a first quote the business name and
 * license render as gaps in his own letterhead, and the gaps are the way to
 * fill them (7c). Send stays live; with gaps it opens the fill instead of
 * refusing.
 *
 * **Width buys checking, not a different document** (7e): a short list of
 * what he is about to send, each with a way back to that part of the quote.
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
  const gaps = !office.businessName || !office.license;

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
      <ResponsiveDialogContent desktopClassName="sm:max-w-3xl">
        <ResponsiveDialogHeader
          title={
            <span className="flex items-center gap-2">
              <span className="text-muted-foreground font-label text-[11px] uppercase">
                What {demo ? "a customer would see" : `${firstName} sees`}
              </span>
              {demo ? <DemoChip /> : null}
            </span>
          }
        />

        <ResponsiveDialogBody className="bg-muted/30 grid items-start gap-4 p-3 md:grid-cols-[minmax(0,28rem)_minmax(0,1fr)]">
          <DocumentSheet
            size="note"
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
              demo={demo}
              onGap={onFillHeader}
              // Her lines as she will see them: the business's signature on
              // its line where the Office applies one, hers still to give.
              signatures={{
                contractor: appliedSignature(office.signature),
                customer: null,
              }}
              signaturePrompt={
                signsOnQuote(draft, office.signature) ? "Sign here to accept" : null
              }
            />
          </DocumentSheet>

          <div className="flex flex-col gap-3">
            {gaps ? (
              <div className="bg-background flex flex-col gap-2.5 rounded-lg border p-4">
                <p className="text-sm">
                  {demo ? "A customer would see" : `${capitalize(firstName)} sees`}{" "}
                  blanks where your name and license go.
                </p>
                <Button
                  size="sm"
                  variant="outline"
                  className="self-start"
                  onClick={onFillHeader}
                >
                  Fill them in
                </Button>
              </div>
            ) : null}

            <div className="bg-background rounded-lg border">
              <p className="text-muted-foreground px-4 pt-3 pb-2 font-label text-[10px] uppercase">
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
        <ResponsiveDialogFooter className="flex gap-2">
          <Button
            variant="outline"
            className="flex-1"
            onClick={() => onOpenChange(false)}
          >
            Keep editing
          </Button>
          <Button className="flex-1" onClick={onSend} disabled={preparing}>
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
