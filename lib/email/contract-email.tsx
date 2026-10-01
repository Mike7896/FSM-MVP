import "server-only";

import { render } from "@react-email/components";

import type { PaperDocument } from "@/lib/documents/paper";
import { formatMoney } from "@/lib/quote";

import {
  DocumentEmail,
  type EmailLetterhead,
} from "./templates/document-email";

/**
 * The email a contract goes out in.
 *
 * Same layout as the quote's, and for the same reason: the page behind the
 * button is the document, where it can also be signed — an attachment would be
 * a copy that can't be.
 *
 * **What the link is for changes what the email says.** Before both signatures
 * it is an ask; after them it is a record, and telling somebody who has already
 * signed to "review and sign" is how a contractor's copy of an agreement
 * becomes a confusing chase.
 */
export async function contractEmail({
  letterhead,
  customerName,
  message,
  title,
  number,
  priceCents,
  url,
  signed,
  paper,
  attached = false,
}: {
  letterhead: EmailLetterhead;
  customerName: string | null;
  message: string | null;
  title: string | null;
  number: string;
  priceCents: number;
  url: string;
  /** Both parties have signed, so this is a copy for their records. */
  signed: boolean;
  /** The contract drawn as its page — the email's body. */
  paper?: PaperDocument | null;
  attached?: boolean;
}) {
  const from = letterhead.name?.trim() || "your contractor";
  const subject = signed
    ? `Your signed contract with ${from}`
    : `Your contract from ${from}`;

  const lead =
    message?.trim() ||
    (signed
      ? `Hi ${firstName(customerName)} — here's your copy of the signed contract, for your records.`
      : `Hi ${firstName(customerName)} — here's the contract. You can read it and sign it on the link below.`);

  const element = (
    <DocumentEmail
      letterhead={letterhead}
      preview={signed ? `Your signed contract with ${from}` : `Your contract from ${from}, ready to sign`}
      message={lead}
      paper={paper}
      attached={attached}
      card={{
        eyebrow: `Contract · ${number}`,
        title: title?.trim() || null,
        rows: [
          { label: "Agreed price", value: formatMoney(priceCents), strong: true },
          { label: "Signatures", value: signed ? "Signed by both of you" : "Waiting on yours" },
        ],
        action: { label: signed ? "Open your contract" : "Read and sign", url },
      }}
    />
  );

  return {
    subject,
    html: await render(element),
    text: await render(element, { plainText: true }),
  };
}

function firstName(name: string | null) {
  return name?.trim().split(/\s+/)[0] || "there";
}
