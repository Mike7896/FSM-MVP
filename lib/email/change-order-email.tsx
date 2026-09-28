import "server-only";

import { render } from "@react-email/components";

import type { PaperDocument } from "@/lib/documents/paper";
import { formatMoney } from "@/lib/quote";

import { firstName } from "./words";
import { DocumentEmail, type EmailLetterhead } from "./templates/document-email";

/**
 * The email a change order goes out in — the same letterhead and layout as the
 * quote and the contract it amends, because it is the same conversation.
 *
 * **The number that matters is the change**, not a total: "+$1,250" is what
 * the customer is being asked to agree to, and the page behind the button
 * shows the rest.
 */
export async function changeOrderEmail({
  letterhead,
  customerName,
  number,
  title,
  deltaCents,
  timeImpactDays,
  url,
  paper,
  attached = false,
}: {
  letterhead: EmailLetterhead;
  customerName: string | null;
  number: string;
  title: string | null;
  deltaCents: number;
  timeImpactDays: number | null;
  url: string;
  /** The change drawn as its page — the email's body. */
  paper?: PaperDocument | null;
  attached?: boolean;
}) {
  const from = letterhead.name?.trim() || "your contractor";
  const change =
    deltaCents > 0
      ? `+${formatMoney(deltaCents)}`
      : deltaCents < 0
        ? `−${formatMoney(Math.abs(deltaCents))}`
        : "No change to the price";

  const rows: { label: string; value: string; strong?: boolean }[] = [
    { label: "Price change", value: change, strong: true },
  ];
  if (timeImpactDays) {
    rows.push({
      label: "Time",
      value: `${timeImpactDays > 0 ? "+" : "−"}${Math.abs(timeImpactDays)} ${Math.abs(timeImpactDays) === 1 ? "day" : "days"}`,
    });
  }

  const element = (
    <DocumentEmail
      letterhead={letterhead}
      preview={`A change to your job from ${from}, ready for your approval`}
      message={`Hi ${firstName(customerName)} — here's a change to the work we agreed. You can read it and approve or decline it on the link below.`}
      paper={paper}
      attached={attached}
      card={{
        eyebrow: `Change order · ${number}`,
        title: title?.trim() || null,
        rows,
        action: { label: "Review the change", url },
      }}
    />
  );

  return {
    subject: `A change to your job from ${from} — ${number}`,
    html: await render(element),
    text: await render(element, { plainText: true }),
  };
}
