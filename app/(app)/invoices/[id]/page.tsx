import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { ExternalLink } from "lucide-react";

import { InvoiceSend } from "@/components/invoices/invoice-send";
import { PageHeader } from "@/components/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { jobSettlement } from "@/lib/billing";
import { requireActiveOrganization } from "@/lib/dal";
import { emailConfigured } from "@/lib/email/send";
import { getInvoice, type InvoiceDetail } from "@/lib/queries/invoices";
import { absoluteUrl } from "@/lib/env";
import { formatMoney } from "@/lib/quote";

export const metadata: Metadata = { title: "Invoice" };

export default async function InvoicePage({
  params,
}: PageProps<"/invoices/[id]">) {
  const org = await requireActiveOrganization();
  const { id } = await params;

  const invoice = await getInvoice(id, org.id);
  if (!invoice) notFound();

  const firstName = invoice.customerName.split(/\s+/)[0];
  const partlyPaid =
    invoice.paidCents > 0 && invoice.outstandingCents > 0;

  // The final bill carries the whole settlement — contract, every approved
  // change order, everything billed and paid. Only it needs the arithmetic.
  const settlement =
    invoice.type === "final_balance"
      ? await jobSettlement(invoice.jobId, org.id)
      : null;

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-8">
      <PageHeader
        title={`Invoice ${invoice.number}`}
        description={[invoice.customerName, invoice.covers]
          .filter(Boolean)
          .join(" · ")}
      />

      {/* Escalation is structural, not chromatic: past a month the row becomes
          an object with its own frame and a changed verb, because a fifth
          automated reminder has stopped being a plan. */}
      {invoice.daysPastDue > 30 ? (
        <div className="border-destructive/50 rounded-xl border border-l-4 p-5">
          <p className="text-destructive font-label text-[11px] uppercase">
            {invoice.daysPastDue} days past due
          </p>
          <p className="mt-1 text-sm">
            {invoice.customerName} hasn&apos;t paid, and reminders have stopped
            working.
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            <Button size="sm" asChild>
              <Link href={`/customers/${invoice.customerId}`}>
                Call {firstName}
              </Link>
            </Button>
          </div>
        </div>
      ) : invoice.daysPastDue > 0 ? (
        <p className="text-destructive text-sm">
          {invoice.daysPastDue} day{invoice.daysPastDue === 1 ? "" : "s"} past
          due.
        </p>
      ) : null}

      <div className="rounded-lg border p-6">
        <div className="flex flex-wrap items-baseline justify-between gap-4">
          <div>
            <Badge variant="secondary" className="capitalize">
              {invoice.type.replace(/_/g, " ")}
            </Badge>
            {invoice.covers ? (
              <p className="text-muted-foreground mt-2 text-sm">
                {invoice.covers}
              </p>
            ) : null}
          </div>
          <div className="text-right">
            <p className="text-muted-foreground font-label text-[10px] uppercase">
              {partlyPaid ? "Still owed" : "Amount due"}
            </p>
            <p className="text-3xl font-semibold tabular-nums">
              {formatMoney(invoice.outstandingCents)}
            </p>
            {partlyPaid ? (
              <p className="text-muted-foreground mt-1 text-xs tabular-nums">
                {formatMoney(invoice.paidCents)} of{" "}
                {formatMoney(invoice.amountDueCents)} paid
              </p>
            ) : null}
          </div>
        </div>

        <Separator className="my-5" />

        <div className="grid gap-3 text-sm sm:grid-cols-2">
          <Field label="Status">
            <span className="capitalize">{invoice.effectiveStatus}</span>
          </Field>
          <Field label="Due">{invoice.dueOn ?? "No date set"}</Field>
          <Field label="Job">
            <Link
              href={`/jobs/${invoice.jobId}`}
              className="text-primary-ink underline underline-offset-4"
            >
              {invoice.jobName ?? "Open the job"}
            </Link>
          </Field>
          <Field label="Sourced from">
            {/* Invoices bill the Contract, never the Quote — once a quote is
                accepted the contract is the agreed document, and billing a
                superseded quote drops approved change orders off the bill. */}
            {invoice.sourceDocumentId ? "The agreement" : "Standalone"}
          </Field>
        </div>
      </div>

      {/* The settlement: what was agreed, what changed it, and everything
          already asked for — so the last bill is arithmetic she can check
          rather than a number to take on trust. */}
      {settlement ? (
        <section>
          <p className="text-muted-foreground mb-2 font-label text-[11px] uppercase">
            How this balance is worked out
          </p>
          <SettlementLine
            label="Agreed"
            cents={settlement.contractSumCents}
            detail="The contract"
          />
          {settlement.changeOrders.map((change) => (
            <SettlementLine
              key={change.id}
              label={change.whatChanged ?? "Change order"}
              cents={change.deltaCents}
              detail={change.number}
              signed
            />
          ))}
          {settlement.bills
            .filter((bill) => bill.id !== invoice.id)
            .map((bill) => (
              <SettlementLine
                key={bill.id}
                label={bill.covers ?? billLabel(bill.type)}
                cents={-bill.amountCents}
                detail={`${bill.number} · ${formatMoney(bill.paidCents)} paid`}
                signed
              />
            ))}
          <div className="flex items-baseline justify-between gap-4 border-t pt-4">
            <span className="font-label text-[11px] uppercase">
              This bill
            </span>
            <span className="text-lg font-semibold tabular-nums">
              {formatMoney(invoice.amountDueCents)}
            </span>
          </div>
        </section>
      ) : null}

      {/* Sending is its own act, with his words on it — the same as a quote. */}
      {invoice.effectiveStatus !== "void" ? (
        <InvoiceSend
          invoiceId={invoice.id}
          customerName={invoice.customerName}
          customerEmail={invoice.customerEmail}
          amountLabel={formatMoney(invoice.outstandingCents)}
          emailEnabled={emailConfigured()}
          sent={invoice.sentAt !== null}
          shareUrl={
            invoice.shareToken ? absoluteUrl(`/share/${invoice.shareToken}`) : null
          }
        />
      ) : null}

      {invoice.entries.length > 0 ? (
        <section>
          <p className="text-muted-foreground mb-2 font-label text-[11px] uppercase">
            Money
          </p>
          {/* Every movement, not a net figure. "She paid $2,000 and $400 came
              back in March" is the fact a contractor needs; one settled number
              hides the half that gets disputed. */}
          {invoice.entries.map((entry) => (
            <div
              key={entry.id}
              className="flex items-baseline justify-between gap-4 border-t py-4"
            >
              <div>
                <p className="text-sm">
                  {entryLabel(entry.entryType, entry.reversesId !== null)}
                  {entry.method ? (
                    <span className="text-muted-foreground">
                      {" "}
                      · {entry.method.replace(/_/g, " ")}
                    </span>
                  ) : null}
                  {entry.source === "manual" ? (
                    <span className="text-muted-foreground">
                      {" "}
                      · recorded by you
                    </span>
                  ) : null}
                </p>
                <p className="text-muted-foreground mt-1 text-xs">
                  {entry.occurredAt.toISOString().slice(0, 10)}
                  {entry.memo ? ` · ${entry.memo}` : ""}
                </p>
              </div>
              <span className="font-medium tabular-nums">
                {entry.amountCents < 0 ? "−" : ""}
                {formatMoney(Math.abs(entry.amountCents))}
              </span>
            </div>
          ))}
        </section>
      ) : null}

      {/* Only rendered once the invoice has actually been shared. A link to a
          page that does not exist yet is worse than no link. */}
      {invoice.shareToken ? (
        <Link
          href={`/share/${invoice.shareToken}`}
          className="hover:bg-muted/50 flex items-center justify-between gap-4 rounded-lg border p-4 transition-colors"
        >
          <div>
            <p className="text-sm font-medium">See what {firstName} sees</p>
            <p className="text-muted-foreground mt-1 text-xs">
              The same link pattern she has used since the quote — no account,
              no login.
            </p>
          </div>
          <ExternalLink className="text-muted-foreground size-4 shrink-0" />
        </Link>
      ) : (
        <p className="text-muted-foreground rounded-lg border border-dashed p-5 text-sm">
          This invoice hasn&apos;t been sent yet, so there&apos;s no link for{" "}
          {firstName} to pay from.
        </p>
      )}
    </div>
  );
}

/** One line of the settlement — a figure with what it is beside it. */
function SettlementLine({
  label,
  cents,
  detail,
  signed = false,
}: {
  label: string;
  cents: number;
  detail?: string;
  /** Show the direction: a change order adds, a bill already sent comes off. */
  signed?: boolean;
}) {
  return (
    <div className="flex items-baseline justify-between gap-4 border-t py-3">
      <div className="min-w-0">
        <p className="text-sm">{label}</p>
        {detail ? (
          <p className="text-muted-foreground mt-1 text-xs">{detail}</p>
        ) : null}
      </div>
      <span className="shrink-0 text-sm tabular-nums">
        {signed ? (cents < 0 ? "−" : "+") : ""}
        {formatMoney(Math.abs(cents))}
      </span>
    </div>
  );
}

function billLabel(type: InvoiceDetail["type"]): string {
  return type === "deposit"
    ? "Deposit"
    : type === "draw"
      ? "Progress payment"
      : "Final balance";
}

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex justify-between gap-4">
      <span className="text-muted-foreground">{label}</span>
      <span className="text-right">{children}</span>
    </div>
  );
}

/**
 * What a ledger row is called on the page.
 *
 * A reversal carries the same `entryType` as the row it cancels — that is what
 * makes the arithmetic check out — so the type alone would render two rows with
 * identical labels and opposite amounts, which reads like a duplicate rather
 * than a correction.
 */
function entryLabel(
  type: InvoiceDetail["entries"][number]["entryType"],
  reversal: boolean
): string {
  if (reversal) return "Correction";

  switch (type) {
    case "payment_received":
      return "Payment";
    case "refund_issued":
      return "Refund";
    case "chargeback_opened":
      return "Disputed by the bank";
    case "chargeback_reversed":
      return "Dispute resolved in your favour";
    case "processing_fee":
      return "Processing fee";
    case "application_fee":
      return "Platform fee";
    case "payout":
      return "Paid out to your bank";
    case "adjustment":
      return "Adjustment";
  }
}
