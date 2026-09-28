import { Check, Clock } from "lucide-react";

import { SignatureMark } from "@/components/signing/signature-mark";
import type { AnyDocument } from "@/lib/documents/types";
import { outstandingSignatures } from "@/lib/signing/sign";
import { cn } from "@/lib/utils";

/**
 * Where the document stands — the strip a contractor glances at.
 *
 * The one question this answers is *whose move is it*, and it answers it in the
 * order the product asks: the contractor signs at generation, so an unsigned
 * contractor row means the shop is holding things up, and an unsigned customer
 * row means she is. A generic "awaiting signatures" would make those two look
 * the same, and only one of them is something he can act on.
 *
 * Signed rows show the mark, because a contractor scanning a job wants to see
 * that she actually signed rather than read that she did.
 */
export function SignatureStatus({
  document,
  className,
}: {
  document: AnyDocument;
  className?: string;
}) {
  const parties = outstandingSignatures(document);
  if (parties.length === 0) return null;

  const signed = parties.filter((p) => p.signed).length;

  return (
    <div className={cn("rounded-xl border", className)}>
      <div className="flex items-baseline justify-between gap-4 border-b px-4 py-3">
        <p className="font-label text-[11px] uppercase">
          Signatures
        </p>
        <p className="text-muted-foreground text-xs">
          {signed} of {parties.length}
          {document.frozenAt ? " · complete" : ""}
        </p>
      </div>

      <div className="divide-y">
        {parties.map((party) => {
          const signature = document.signatures.find(
            (s) => s.party === party.party
          );

          return (
            <div
              key={party.party}
              className="flex items-center justify-between gap-4 px-4 py-3"
            >
              <div className="min-w-0">
                <p className="text-sm">
                  {party.party === "contractor" ? "You" : "The customer"}
                </p>
                <p className="text-muted-foreground mt-1 text-xs">
                  {signature
                    ? `${signature.printedName} · ${signature.signedAt.toLocaleDateString(
                        "en-US",
                        { month: "short", day: "numeric", year: "numeric" }
                      )}`
                    : party.party === "contractor"
                      ? "Not signed yet — she can't be asked until you have"
                      : "Waiting on her"}
                </p>
              </div>

              {signature ? (
                <div className="flex shrink-0 items-center gap-3">
                  <SignatureMark
                    value={signature.signatureData}
                    className="h-8 w-auto max-w-32"
                  />
                  <Check className="text-muted-foreground size-4 shrink-0" />
                </div>
              ) : (
                <Clock className="text-muted-foreground size-4 shrink-0" />
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
