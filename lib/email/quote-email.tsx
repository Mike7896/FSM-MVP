import "server-only";

import { render } from "@react-email/components";

import type { PaperDocument } from "@/lib/documents/paper";
import { formatMoney } from "@/lib/quote";

import {
  DocumentEmail,
  type EmailLetterhead,
} from "./templates/document-email";

/**
 * The email a quote goes out in.
 *
 * **His words, then the quote.** The message is whatever the contractor left in
 * the send sheet; under it, the card says what the quote is and what it comes
 * to, and the button opens it. The link cannot be removed — it is the whole
 * point of the email.
 *
 * The button says what she will do there: sign, when the quote carries lines
 * she accepts it on, and otherwise look it over.
 */
export type QuoteEmailInput = {
  letterhead: EmailLetterhead;
  customerName: string | null;
  message: string;
  /** Left out, the subject is written from the quote. */
  subject?: string | null;
  title: string | null;
  number: string | null;
  totalCents: number;
  depositCents: number | null;
  /** The last day the price holds, as stored — `2026-10-14`. */
  validUntil: string | null;
  /** She accepts by signing the quote itself. */
  signs: boolean;
  /** Null in the send sheet's preview, before the link exists. */
  url: string | null;
  demo: boolean;
  /** The quote drawn as its page — the email's body. */
  paper?: PaperDocument | null;
  /** A PDF of it is attached. */
  attached?: boolean;
};

export function quoteSubject({
  letterhead,
  title,
  demo,
}: Pick<QuoteEmailInput, "letterhead" | "title" | "demo">): string {
  const from = letterhead.name?.trim() || "your contractor";
  if (demo) return `Your demo quote from ${from}`;
  return title?.trim() ? `Your quote from ${from}: ${title.trim()}` : `Your quote from ${from}`;
}

export { quoteMessage } from "./words";

export async function quoteEmail(input: QuoteEmailInput) {
  const subject = input.subject?.trim() || quoteSubject(input);
  const from = input.letterhead.name?.trim() || "your contractor";

  const rows = [
    { label: "Total", value: formatMoney(input.totalCents), strong: true },
    input.depositCents
      ? { label: "Deposit to book the work", value: formatMoney(input.depositCents) }
      : null,
    input.validUntil ? { label: "Price holds until", value: dayOf(input.validUntil) } : null,
  ].filter((row): row is { label: string; value: string; strong?: boolean } => row !== null);

  const element = (
    <DocumentEmail
      letterhead={input.letterhead}
      preview={`${input.title?.trim() || "Your quote"} from ${from} — ${formatMoney(input.totalCents)}`}
      message={input.message}
      demo={input.demo}
      paper={input.paper}
      attached={input.attached}
      card={{
        eyebrow: input.number ? `Quote · ${input.number}` : "Quote",
        title: input.title?.trim() || null,
        rows,
        action: {
          label: input.signs ? "Review and sign" : "View your quote",
          url: input.url,
        },
      }}
    />
  );

  return {
    subject,
    html: await render(element),
    text: await render(element, { plainText: true }),
  };
}

/** "October 14" — a calendar date as stored, read in its own day. */
function dayOf(iso: string) {
  return new Date(`${iso}T12:00:00Z`).toLocaleDateString("en-US", {
    month: "long",
    day: "numeric",
    timeZone: "UTC",
  });
}
