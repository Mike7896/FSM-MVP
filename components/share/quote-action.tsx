import { approveLabel, signLabel } from "@/components/quote/projection";
import { ApproveButton } from "@/components/share/approve-button";
import { ResponsePanel } from "@/components/share/frame";
import { dayOf } from "@/components/share/note";
import { QuoteSignature } from "@/components/share/quote-signature";
import { Button } from "@/components/ui/button";
import type { SharedQuote } from "@/lib/queries/share";

/**
 * What the customer can do with a quote — the panel under the page, in
 * whatever state the quote is in.
 *
 * Approving is the main line. Every other state says what is true and where to
 * go instead — an approved quote points at its contract, a lapsed price at the
 * business, a demo says it can't be approved — and never shows a button that
 * does nothing. A link sent only to be read has no panel at all.
 */
export function QuoteAction({
  token,
  shared,
}: {
  token: string;
  shared: SharedQuote;
}) {
  const business = shared.office.businessName ?? "the business";
  const today = new Date().toISOString().slice(0, 10);

  if (shared.demo) {
    return (
      <ResponsePanel
        title="This is a demo"
        description="It shows what your customer sees. Approving is switched off."
      />
    );
  }

  if (shared.status === "accepted") {
    const contract = shared.contract;
    return (
      <ResponsePanel
        title={`You approved this quote${contract?.acceptedAt ? ` on ${dayOf(contract.acceptedAt)}` : ""}`}
        description={
          contract?.signed
            ? "Your contract is signed by both of you."
            : contract
              ? "Next is the contract — the same work and price, as the version you both sign."
              : null
        }
      >
        {contract?.url ? (
          <Button asChild size="lg" className="h-12 text-base">
            <a href={contract.url}>
              {contract.signed ? "Open your contract" : "Sign the contract"}
            </a>
          </Button>
        ) : null}
      </ResponsePanel>
    );
  }

  if (shared.validUntil && shared.validUntil < today) {
    return (
      <ResponsePanel
        title="This price has lapsed"
        description={`It held until ${dayOf(shared.validUntil)}. Ask ${business} for an updated quote.`}
      />
    );
  }

  if (shared.status === "declined" || shared.status === "expired") {
    return (
      <ResponsePanel
        title="This quote is closed"
        description={`Ask ${business} for an updated one.`}
      />
    );
  }

  // A link sent only to be read has nothing to press.
  if (!shared.scopes.includes("accept")) return null;

  // Signature lines, and the business's already on its line: accepting is
  // signing hers. The contract that follows arrives signed by both.
  if (shared.signing) {
    return (
      <ResponsePanel>
        <QuoteSignature
          token={token}
          hash={shared.hash}
          customerName={shared.draft.customerName || null}
          businessName={shared.office.businessName}
          actionLabel={signLabel(shared.draft)}
        />
      </ResponsePanel>
    );
  }

  return (
    <ResponsePanel
      title="Ready to go ahead?"
      description="Approving brings up the contract to sign. No account needed."
    >
      <ApproveButton hash={shared.hash} token={token} label={approveLabel(shared.draft)} />
    </ResponsePanel>
  );
}
