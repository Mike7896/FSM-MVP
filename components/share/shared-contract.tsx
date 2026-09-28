import {
  DocumentFooter,
  DocumentSheet,
} from "@/components/documents/document-sheet";
import { QuoteProjection } from "@/components/quote/projection";
import { ContractSignature } from "@/components/share/contract-signature";
import { ResponsePanel } from "@/components/share/frame";
import { dayOf } from "@/components/share/note";
import { Button } from "@/components/ui/button";
import type { SharedContract, SharedSignature } from "@/lib/queries/share";
import { formatMoney } from "@/lib/quote";

/**
 * The contract, on the customer's link — Flow 2's second page.
 *
 * **Nothing on it is new.** The work, price and terms are the ones just read on
 * the quote, so it reads as confirmation rather than a fresh negotiation — the
 * mitigation for adding a step at the highest-intent moment. What it adds is
 * the two signatures: the business's already on it, and the customer's to give.
 *
 * The page carries only what would print. The signing, and what comes after
 * it — the deposit, or nothing at all — sit in the panel below it.
 */
export function ContractSheet({ shared }: { shared: SharedContract }) {
  const contractor = shared.signatures.find((s) => s.party === "contractor");
  const customer = shared.signatures.find((s) => s.party === "customer");

  return (
    <DocumentSheet
      footer={
        <DocumentFooter
          businessName={shared.office.businessName}
          number={shared.number}
        />
      }
    >
      {/* The signatures are on the paper, at its foot — a contract always has
          its lines, whatever its quote said, and a printed copy carries them. */}
      <QuoteProjection
        draft={shared.draft}
        businessName={shared.office.businessName}
        license={shared.office.license}
        phone={shared.office.phone}
        logoUrl={shared.office.logoUrl}
        demo={shared.demo}
        action={null}
        documentLabel="Contract"
        signatureBlock
        signatures={{
          contractor: lineOf(contractor),
          customer: lineOf(customer),
        }}
        signaturePrompt={contractor && !customer ? "Sign below" : null}
      />
    </DocumentSheet>
  );
}

export function ContractResponse({
  token,
  shared,
}: {
  token: string;
  shared: SharedContract;
}) {
  const business = shared.office.businessName ?? "The business";
  const contractor = shared.signatures.find((s) => s.party === "contractor");
  const customer = shared.signatures.find((s) => s.party === "customer");
  const depositCents = shared.depositCents ?? 0;

  if (customer) {
    return <NextStep shared={shared} business={business} depositCents={depositCents} />;
  }

  if (!contractor) {
    return (
      <ResponsePanel
        title={`Waiting on ${business}`}
        description="They sign first. You can sign here as soon as they have."
      />
    );
  }

  return (
    <ResponsePanel>
      <ContractSignature
        token={token}
        customerName={shared.customerName}
        businessName={shared.office.businessName}
        description={`The same work, price and terms as the quote you approved${
          shared.acceptedAt ? ` on ${dayOf(shared.acceptedAt)}` : ""
        } — this is the version you both sign.`}
        actionLabel={
          depositCents > 0
            ? `Sign & continue to the ${formatMoney(depositCents)} deposit`
            : "Sign the contract"
        }
      />
    </ResponsePanel>
  );
}

/** A recorded signature, in the shape the paper's lines draw. */
function lineOf(signature: SharedSignature | undefined) {
  return signature
    ? {
        mark: signature.signatureData,
        printedName: signature.printedName,
        signedAt: signature.signedAt,
      }
    : null;
}

/** After both signatures: what, if anything, is left to do. */
function NextStep({
  shared,
  business,
  depositCents,
}: {
  shared: SharedContract;
  business: string;
  depositCents: number;
}) {
  if (depositCents <= 0) {
    return (
      <ResponsePanel
        title="Signed by both of you"
        description={`You're all set. ${business} will be in touch to schedule the work.`}
      />
    );
  }

  const deposit = shared.deposit;

  if (deposit && deposit.outstandingCents <= 0) {
    return (
      <ResponsePanel
        title="Deposit received"
        description={`Thank you. ${business} will confirm your start date.`}
      />
    );
  }

  if (deposit?.url) {
    return (
      <ResponsePanel
        title="Signed — one step left"
        description={`The deposit books your start date with ${business}.`}
      >
        <Button asChild size="lg" className="h-12 text-base">
          <a href={deposit.url}>
            Pay the {formatMoney(deposit.outstandingCents)} deposit
          </a>
        </Button>
      </ResponsePanel>
    );
  }

  return (
    <ResponsePanel
      title="Signed by both of you"
      description={`${business} will send you the link to pay the deposit.`}
    />
  );
}
