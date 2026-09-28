import "server-only";

import { render } from "@react-email/components";

import type { PaperDocument } from "@/lib/documents/paper";

import {
  DocumentEmail,
  type EmailLetterhead,
} from "./templates/document-email";

/**
 * The email a bill goes out in.
 *
 * **The amount and what it is for are in the subject.** A mid-job money ask
 * that reads "Invoice from Miller Electric" makes someone open it to find out
 * what it is; "Rough-in complete — $2,180 due" answers the question in the
 * inbox, which is where the anxiety actually is.
 *
 * The proof of the work — photos and the write-up — lives on the page behind
 * the button rather than in an attachment nobody can read on a phone.
 */
export async function invoiceEmail({
  letterhead,
  customerName,
  invoiceType,
  number,
  amountLabel,
  work,
  dueOn,
  message,
  url,
  paper,
  attached = false,
}: {
  letterhead: EmailLetterhead;
  customerName: string;
  invoiceType: "deposit" | "draw" | "final_balance";
  number: string;
  amountLabel: string;
  /** What this bill covers — the phase, or the job. */
  work: string | null;
  dueOn: string | null;
  /** The contractor's own words, when he wrote any. */
  message: string | null;
  url: string;
  /** The invoice drawn as its page — the email's body. */
  paper?: PaperDocument | null;
  attached?: boolean;
}) {
  const kind =
    invoiceType === "deposit"
      ? "Deposit"
      : invoiceType === "draw"
        ? work || "Progress payment"
        : "Final balance";

  const subject = `${kind} — ${amountLabel} due`;

  const opening =
    message ??
    `Hi ${firstName(customerName)} — ${
      invoiceType === "draw"
        ? `${work ? `${work} is done` : "the next stage is done"}. The photos and what was done are on the page below.`
        : invoiceType === "final_balance"
          ? "the work's finished. This is the balance, with everything already paid taken off it."
          : "here's the deposit to book the work."
    }`;

  const element = (
    <DocumentEmail
      letterhead={letterhead}
      preview={`${kind} — ${amountLabel} due${dueOn ? ` by ${dayOf(dueOn)}` : ""}`}
      message={opening}
      paper={paper}
      attached={attached}
      card={{
        eyebrow: `${invoiceType === "draw" ? "Progress payment" : kind} · ${number}`,
        title: work,
        rows: [
          { label: "Amount due", value: amountLabel, strong: true },
          ...(dueOn ? [{ label: "Due", value: dayOf(dueOn) }] : []),
        ],
        action: { label: `View and pay ${amountLabel}`, url },
      }}
    />
  );

  return {
    subject,
    html: await render(element),
    text: await render(element, { plainText: true }),
  };
}

function firstName(name: string) {
  return name.trim().split(/\s+/)[0] || "there";
}

function dayOf(iso: string) {
  return new Date(`${iso}T12:00:00Z`).toLocaleDateString("en-US", {
    month: "long",
    day: "numeric",
    timeZone: "UTC",
  });
}
