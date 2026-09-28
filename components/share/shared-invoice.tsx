import {
  DocumentFooter,
  DocumentSheet,
} from "@/components/documents/document-sheet";
import { PaperView } from "@/components/documents/paper-view";
import { ResponsePanel } from "@/components/share/frame";
import { InvoicePayment } from "@/components/share/invoice-payment";
import { dayOf } from "@/components/share/note";
import type { PaperDocument } from "@/lib/documents/paper";
import type { SharedInvoice } from "@/lib/queries/share";
import { formatMoney } from "@/lib/quote";

/**
 * An invoice on the customer's link — the deposit, a draw or the final balance.
 *
 * **One object in three moments**, so all three look like this: the business at
 * the top, what it's for, what's left after everything already paid — on the
 * page — and paying it in the panel under the page.
 *
 * **Evidence first, ask second.** A draw opens with the photographs and the
 * write-up of the work it is for, because the fear a mid-job money request has
 * to answer is that it is opportunistic — and the answer is what was done, not
 * a reassuring sentence. The final balance opens with the settlement instead:
 * the contract, every change order, and everything already paid.
 */
export function InvoiceSheet({
  shared,
  paper,
}: {
  shared: SharedInvoice;
  paper: PaperDocument;
}) {
  const photos = shared.evidence?.photos ?? [];

  return (
    <DocumentSheet
      footer={
        <DocumentFooter businessName={shared.office.businessName} number={shared.number} />
      }
    >
      <PaperView
        paper={paper}
        after={
          photos.length > 0 ? (
            <section className="flex flex-col gap-2">
              <p className="text-muted-foreground font-label text-[10px] uppercase">
                The work
                {shared.evidence?.completedAt
                  ? ` · finished ${dayOf(shared.evidence.completedAt)}`
                  : ""}
              </p>
              <div className="grid grid-cols-2 gap-2 @md:grid-cols-3">
                {photos.map((photo) => (
                  // eslint-disable-next-line @next/next/no-img-element -- short-lived signed Storage URLs
                  <img
                    key={photo.url}
                    src={photo.url}
                    alt={photo.caption ?? ""}
                    className="aspect-square w-full border object-cover"
                  />
                ))}
              </div>
            </section>
          ) : null
        }
      />
    </DocumentSheet>
  );
}

/** Paying it — or, when there's nothing to pay, what's true instead. */
export function InvoiceResponse({
  token,
  shared,
}: {
  token: string;
  shared: SharedInvoice;
}) {
  const Business = shared.office.businessName ?? "The business";
  const business = shared.office.businessName ?? "the business";
  const deposit = shared.invoiceType === "deposit";

  if (shared.voided) {
    return (
      <ResponsePanel
        title="Withdrawn"
        description={`${Business} withdrew this invoice. Nothing is owed on it.`}
      />
    );
  }

  if (shared.outstandingCents <= 0) {
    return (
      <ResponsePanel
        title="Paid — thank you"
        description={
          deposit
            ? `${Business} will confirm your start date.`
            : "Nothing more is owed on this invoice."
        }
      />
    );
  }

  if (shared.demo) {
    return (
      <ResponsePanel
        title="This is a demo"
        description="It shows what your customer sees, so it can't be paid."
      />
    );
  }

  if (!shared.scopes.includes("pay")) {
    return (
      <ResponsePanel
        title={`${formatMoney(shared.outstandingCents)} left to pay`}
        description={`Ask ${business} how they'd like to be paid.`}
      />
    );
  }

  return (
    <ResponsePanel
      title={`Pay ${formatMoney(shared.outstandingCents)}`}
      description={
        shared.dueOn
          ? `Due ${dayOf(shared.dueOn)}. No account needed.`
          : "No account needed."
      }
    >
      <InvoicePayment
        token={token}
        amountLabel={formatMoney(shared.outstandingCents)}
        businessName={shared.office.businessName}
        paidMessage={
          deposit
            ? `Deposit received — thank you. ${Business} will confirm your start date.`
            : "Payment received — thank you."
        }
        failureNote={
          deposit
            ? "Your signature on the contract is safe. Try again, or use a different card."
            : "Nothing was charged. Try again, or use a different card."
        }
      />
    </ResponsePanel>
  );
}
