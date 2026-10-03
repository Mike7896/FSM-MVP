import type { EffectiveInvoiceStatus, InvoiceType } from "@/lib/queries/invoices";

/**
 * WHERE A JOB IS, IN WORDS — the label the job page and the jobs list show.
 *
 * The stored status says how far the work has got (quoting → in progress →
 * complete → paid). On its own it can't tell "complete, waiting on the
 * customer" from "complete, and the bill hasn't gone out" — so the label reads
 * the job's invoices and money as well, which is where those answers live.
 * Worked out on every read, so it can't go stale.
 */

type JobStatus = "quoting" | "scheduled" | "in_progress" | "complete" | "paid";

/** How the label is coloured: who, if anyone, has to act. */
export type StageTone =
  | "neutral" // nothing to do yet
  | "active" // work under way
  | "action" // the contractor has something to do
  | "waiting" // waiting on the customer or the bank
  | "overdue" // waiting too long
  | "done"; // paid in full

export type JobStage = {
  label: string;
  /** One line on what it means, where the label alone doesn't say. */
  detail: string | null;
  tone: StageTone;
};

export type StageInvoice = {
  type: InvoiceType;
  status: string;
  effectiveStatus: EffectiveInvoiceStatus;
  sentAt: Date | null;
  daysPastDue: number;
};

export function jobStage({
  status,
  agreedCents,
  collectedCents,
  invoices,
  workDone = false,
}: {
  status: JobStatus;
  /** The contract plus approved change orders. */
  agreedCents: number;
  collectedCents: number;
  invoices: StageInvoice[];
  /** Every phase in the payment plan is done — from the plan, where there is one. */
  workDone?: boolean;
}): JobStage {
  if (status === "quoting") {
    return { label: "Quoting", detail: null, tone: "neutral" };
  }

  if (agreedCents > 0 && collectedCents >= agreedCents) {
    return { label: "Paid in full", detail: null, tone: "done" };
  }

  // Bills that are out and still owed. A draft hasn't gone anywhere and a
  // voided bill is owed by nobody.
  const owed = invoices.filter(
    (invoice) =>
      !["draft", "void", "paid"].includes(invoice.effectiveStatus)
  );
  const final = invoices.find(
    (invoice) =>
      invoice.type === "final_balance" &&
      !["draft", "void"].includes(invoice.effectiveStatus)
  );

  if (final && final.effectiveStatus !== "paid") {
    const waiting = waitingOn(final, "final invoice");
    return { ...waiting, label: `Complete · ${waiting.label}` };
  }

  if (status === "complete" || status === "paid" || workDone || final) {
    // The work is done and no bill is waiting: whatever's left hasn't been
    // asked for yet.
    if (owed.length > 0) {
      const waiting = waitingOn(owed[0], "invoice");
      return { ...waiting, label: `Complete · ${waiting.label}` };
    }
    return {
      label: "Complete · ready to invoice",
      detail: "The work is done. Send the final invoice to get paid.",
      tone: "action",
    };
  }

  if (status === "scheduled") {
    return { label: "Scheduled", detail: null, tone: "neutral" };
  }

  // In progress: say so, and whether money is out.
  const processing = owed.find((invoice) => invoice.effectiveStatus === "processing");
  const overdue = owed.find((invoice) => invoice.effectiveStatus === "overdue");
  const out = processing ?? overdue ?? owed[0];
  if (out) {
    const waiting = waitingOn(out, "invoice");
    return { ...waiting, label: `In progress · ${waiting.label}` };
  }
  return { label: "In progress", detail: null, tone: "active" };
}

/** What an unpaid bill is waiting on, in a few words and one line. */
function waitingOn(invoice: StageInvoice, name: string): JobStage {
  switch (invoice.effectiveStatus) {
    case "processing":
      return {
        label: "payment processing",
        detail: "A bank payment is clearing. That usually takes a few business days.",
        tone: "waiting",
      };
    case "overdue":
      return {
        label: "payment overdue",
        detail: `The ${name} is ${invoice.daysPastDue} day${invoice.daysPastDue === 1 ? "" : "s"} past due.`,
        tone: "overdue",
      };
    default:
      if (!invoice.sentAt) {
        return {
          label: "invoice not sent",
          detail: `The ${name} is ready. Send it to get paid.`,
          tone: "action",
        };
      }
      return {
        label: "waiting on payment",
        detail:
          invoice.status === "viewed"
            ? `The customer has opened the ${name}.`
            : `The ${name} is sent.`,
        tone: "waiting",
      };
  }
}

/**
 * Where one invoice stands, said for the contractor: a short label and one
 * line on what's happening, from what the money says rather than a stored
 * status somebody has to remember to change.
 */
export function invoiceStage(
  invoice: StageInvoice & {
    amountDueCents: number;
    paidCents: number;
    outstandingCents: number;
    processingCents: number;
    paidAt: Date | null;
  },
  customerFirstName: string,
  formatMoney: (cents: number) => string
): JobStage {
  const who = customerFirstName || "The customer";

  switch (invoice.effectiveStatus) {
    case "void":
      return { label: "Void", detail: "Cancelled. Nobody owes this.", tone: "neutral" };
    case "draft":
      return { label: "Draft", detail: "Not issued or sent yet.", tone: "neutral" };
    case "paid":
      return {
        label: "Paid",
        detail: invoice.paidAt
          ? `Paid in full on ${invoice.paidAt.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}.`
          : "Paid in full.",
        tone: "done",
      };
    case "processing":
      return {
        label: "Payment processing",
        detail: `${formatMoney(invoice.processingCents)} is on its way from ${who}'s bank. That usually takes a few business days.`,
        tone: "waiting",
      };
    case "overdue":
      return {
        label: "Overdue",
        detail: `${invoice.daysPastDue} day${invoice.daysPastDue === 1 ? "" : "s"} past due${invoice.paidCents > 0 ? `, with ${formatMoney(invoice.outstandingCents)} still owed` : ""}.`,
        tone: "overdue",
      };
  }

  if (!invoice.sentAt) {
    return {
      label: "Ready to send",
      detail: `Issued, but not sent to ${who} yet.`,
      tone: "action",
    };
  }

  if (invoice.paidCents > 0) {
    return {
      label: "Partly paid",
      detail: `${formatMoney(invoice.paidCents)} of ${formatMoney(invoice.amountDueCents)} paid.`,
      tone: "waiting",
    };
  }

  return {
    label: "Waiting on payment",
    detail:
      invoice.status === "viewed"
        ? `${who} has opened it.`
        : `Sent. ${who} hasn't opened it yet.`,
    tone: "waiting",
  };
}
