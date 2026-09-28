import { SignatureMark } from "@/components/signing/signature-mark";
import type { DocumentSignatures, LineSignature } from "@/lib/signing/lines";
import { parseMark } from "@/lib/signing/mark";

/**
 * The foot of an agreement: a line for each party — Quote Document Structure
 * §3.5, Acceptance.
 *
 * **Drawn on the paper, not beside it.** The printed copy and the PDF are the
 * versions that travel, and a signature that only exists in a box under the
 * web page is one the printed page never carries. So the lines are part of the
 * sheet, with room above each rule for a mark — the recorded one, the business's
 * stored one ahead of acceptance, or a pen on a printed copy.
 *
 * Server-safe and stateless, like `SignatureMark`: the contractor's view, the
 * customer's link, the preview and the print are one definition.
 */
export function SignatureLines({
  businessName,
  customerName,
  signatures,
  prompt,
}: {
  businessName: string | null;
  customerName: string | null;
  signatures: DocumentSignatures;
  /**
   * What the customer's empty line says in place of a mark — "Sign below to
   * accept" on her link. Left out, the line is blank, which is what a printed
   * copy wants: somewhere to put a pen.
   */
  prompt?: string | null;
}) {
  return (
    <section className="mt-4">
      <p className="text-muted-foreground font-label text-[10px] uppercase">
        Acceptance
      </p>
      <p className="text-muted-foreground mt-1 text-xs leading-relaxed">
        Signed by both of you, this is an agreement to the work, price and terms
        above.
      </p>

      {/* Side by side once the page is wide enough for both names, measured
          from the page rather than the window: the Office's miniature is a
          narrow page on a wide screen. */}
      <div className="mt-2 grid gap-x-8 gap-y-6 @2xs:grid-cols-2">
        <Line
          who={businessName ? `For ${businessName}` : "For the business"}
          signature={signatures.contractor}
        />
        <Line
          who={customerName?.trim() || "Customer"}
          role="Customer"
          signature={signatures.customer}
          prompt={prompt}
        />
      </div>
    </section>
  );
}

function Line({
  who,
  role,
  signature,
  prompt,
}: {
  /** Whose line this is — who is expected to sign it. */
  who: string;
  /**
   * Said instead of `who` once they have signed as themselves, so the name
   * isn't printed twice under one line.
   */
  role?: string;
  signature: LineSignature | null;
  prompt?: string | null;
}) {
  const said =
    role && signature && signature.printedName.trim() === who ? role : who;

  return (
    <div className="min-w-0">
      {/* Room for a signature whether or not one is here yet — a printed copy
          is signed in this space by hand. */}
      <div className="flex h-16 items-end overflow-hidden pb-1">
        {signature ? (
          <SignatureMark
            value={signature.mark}
            className={
              parseMark(signature.mark).kind === "drawn"
                ? "h-14 w-auto max-w-full"
                : // Sits on the rule like ink, and on one line always: a
                  // typed name that wraps stops reading as a signature.
                  "text-[18pt] leading-none whitespace-nowrap"
            }
          />
        ) : prompt ? (
          <span className="text-muted-foreground text-xs">{prompt}</span>
        ) : null}
      </div>

      <div className="border-foreground/70 border-t" />

      <div className="mt-1.5 flex items-baseline justify-between gap-3 text-xs">
        <span className="min-w-0 truncate">
          {signature?.printedName ?? (
            <span className="text-muted-foreground">Signature</span>
          )}
        </span>
        <span className="text-muted-foreground shrink-0 tabular-nums">
          {signature?.signedAt ? dateOf(signature.signedAt) : "Date"}
        </span>
      </div>
      <p className="text-muted-foreground mt-0.5 truncate text-xs">{said}</p>
    </div>
  );
}

/** "Sep 24, 2026" — a date a signature line can carry. */
function dateOf(value: Date | string) {
  return new Date(value).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}
