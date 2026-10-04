import { RequestChange } from "@/components/change-orders/request";
import { requestContext } from "@/lib/change-orders/requests";
import { ChangeOrderResponse } from "@/components/change-orders/shared";
import { cache } from "react";
import { notFound } from "next/navigation";
import type { Metadata } from "next";

import { InfoRequestReply } from "@/components/jobs/info-request-reply";
import {
  DocumentFooter,
  DocumentSheet,
} from "@/components/documents/document-sheet";
import { PaperView } from "@/components/documents/paper-view";
import { QuoteProjection, approveLabel, signLabel } from "@/components/quote/projection";
import { ShareBar } from "@/components/share/frame";
import { QuoteAction } from "@/components/share/quote-action";
import { ContractResponse, ContractSheet } from "@/components/share/shared-contract";
import { InvoiceResponse, InvoiceSheet } from "@/components/share/shared-invoice";
import { paperFor } from "@/lib/documents/paper";
import { formatMoney } from "@/lib/quote";
import { requireMembership } from "@/lib/dal";
import { issueDepositInvoice, recordShareView } from "@/lib/documents";
import { listInfoRequests, resolveInfoToken } from "@/lib/field/info-requests";
import { resolveShareToken, type SharedDocument } from "@/lib/queries/share";
import { reconcileOpenPayments } from "@/lib/stripe/collect";

/** One read per request — the title and the page both need it. */
const resolve = cache(resolveShareToken);

const TITLES = {
  quote: "Your quote",
  contract: "Your contract",
  invoice: "Your invoice",
  change_order: "Your change order",
} as const;

export async function generateMetadata({
  params,
}: PageProps<"/share/[token]">): Promise<Metadata> {
  const shared = await resolve((await params).token);

  return {
    title: shared ? TITLES[shared.kind] : "Link not found",
    // Never indexed. A capability URL that turns up in a search result is not a
    // capability URL any more.
    robots: { index: false, follow: false },
  };
}

/**
 * The share surface · **class C** · Object Model §5.7.
 *
 * One product surface whose mode is set by the document behind the token. Same
 * header, same trust signals, same no-account rule in every mode — **continuity
 * is the trust mechanism**. The contract, each draw, the final invoice and
 * post-job requests all arrive as this same experience, so mid-job money asks
 * feel scheduled rather than alarming.
 *
 * Flow 2 runs through three of its modes, one link each: the quote, where the
 * customer approves → the contract that approval generated, where they sign →
 * the deposit that signing issued, where they pay.
 *
 * Three properties that are not styling choices:
 *
 * - **No navigation, no account, one primary action.** The token *is* the
 *   permission, so there is nothing for an account to hold and nothing for an
 *   install to add. This is mobile web permanently and never opens an app —
 *   including on the contractor's own phone.
 * - **It is a projection, not a permission level.** `resolveShareToken` returns
 *   the customer-visible attributes only; cost, markup, internal notes and the
 *   five pricing decisions are absent from the payload rather than merely
 *   unrendered.
 * - **It renders the same component the contractor previewed**, so what was
 *   approved in the editor is what the customer opens.
 *
 * An unknown, revoked or expired token is a 404 rather than an explanation.
 * Telling a stranger that a token *used* to be valid is telling them a token
 * exists.
 */
export default async function SharePage({ params }: PageProps<"/share/[token]">) {
  const { token } = await params;

  let shared = await resolve(token);
  if (!shared) notFound();

  // Signed by both parties, a deposit in its terms, and no payable deposit
  // behind it: the issue failed after the signature landed. The signature
  // stood — the yes is the hard part — so the ask is issued now and the page
  // reads again.
  if (
    shared.kind === "contract" &&
    shared.status === "signed" &&
    (shared.depositCents ?? 0) > 0 &&
    (!shared.deposit || !shared.deposit.url)
  ) {
    const issued = await issueDepositInvoice({
      organizationId: shared.organizationId,
      contractId: shared.documentId,
    }).catch((error) => {
      console.error("[share] the deposit didn't issue:", error);
      return null;
    });
    if (issued) shared = (await resolveShareToken(token)) ?? shared;
  }

  // Back from paying: Stripe knows before the webhook does — and on a laptop
  // with no webhook forwarding, Stripe is the only one who knows. Ask, record,
  // and read again so the page says "paid" now.
  if (shared.kind === "invoice") {
    const checked = await reconcileOpenPayments([shared.documentId]).catch(
      (error) => {
        console.error("[share] couldn't check the payment with Stripe:", error);
        return false;
      }
    );
    if (checked) shared = (await resolveShareToken(token)) ?? shared;
  }

  const canRequestChange = !shared.demo && await requestContext(token).then(() => true).catch(() => false);
  const requests = shared.kind === "quote" && shared.scopes.includes("reply")
    ? await listInfoRequests((await resolveInfoToken(token)).documentId)
    : [];

  // The customer opening it is the fact the business is waiting for, so the
  // business's own check of the link is not recorded as one — "opened" has to
  // mean the customer looked. A demo is the exception: it went only to the
  // contractor, and watching their own open land is the point of it. Awaited
  // rather than floated so it cannot be cut short.
  const member = await requireMembership(shared.organizationId);
  if (!member || shared.demo) await recordShareView(token);

  // One reading of the document for the bar's name and the paper below it —
  // the same one the PDF and the email are drawn from.
  const paper = paperFor(shared);

  return (
    // **The desk, and the paper on it.** The page carries only what would
    // print; what she can do with it — approve, sign, pay, answer, ask for a
    // change — sits in panels under the sheet, never on it.
    //
    // The desk is DocumentDesk's, so she sees the page the contractor
    // previewed: at /50 it was #fafbfc, and the white sheet barely lay on
    // anything. The print reset is important so the dark desk can't outrank
    // it on paper, and the column drops its padding there, as the desk does.
    <div className="bg-muted dark:bg-muted/40 flex min-h-svh flex-col print:bg-transparent!">
      <ShareBar
        business={shared.office.businessName}
        label={paper.label}
        ink={shared.kind === "change_order" ? "Change order" : shared.kind}
        number={paper.number}
        pdfHref={`/api/share/${token}/pdf`}
        respond={respondLabel(shared)}
      />

      <main className="mx-auto flex w-full max-w-[calc(8.5in+3rem)] flex-1 flex-col gap-5 pb-12 sm:px-6 sm:pt-8 print:p-0">
        {requests.length > 0 ? (
          <div className="mx-4 flex flex-col gap-4 pt-4 sm:mx-0 sm:pt-0 print:hidden">
            {requests.map((request) => (
              <InfoRequestReply key={request.id} token={token} request={request} />
            ))}
          </div>
        ) : null}

        {shared.kind === "quote" ? (
          <>
            <DocumentSheet
              footer={
                <DocumentFooter
                  businessName={shared.office.businessName}
                  number={shared.draft.number}
                  promo={shared.office.promoFooter ?? true}
                />
              }
            >
              <QuoteProjection
                draft={shared.draft}
                businessName={shared.office.businessName}
                license={shared.office.license}
                phone={shared.office.phone}
                logoUrl={shared.office.logoUrl}
                demo={shared.demo}
                action={null}
                documentLabel="Quote"
                signatures={shared.signatures}
                signaturePrompt={shared.signing ? "Sign below to accept" : null}
              />
            </DocumentSheet>
            <QuoteAction token={token} shared={shared} />
          </>
        ) : shared.kind === "contract" ? (
          <>
            <ContractSheet shared={shared} />
            <ContractResponse token={token} shared={shared} />
          </>
        ) : shared.kind === "change_order" ? (
          <>
            <DocumentSheet
              footer={
                <DocumentFooter
                  businessName={shared.office.businessName}
                  number={shared.number}
                  promo={shared.office.promoFooter ?? true}
                />
              }
            >
              <PaperView
                paper={paper}
                signaturePrompt={
                  shared.status === "sent" && shared.scopes.includes("sign")
                    ? "Sign below to approve"
                    : null
                }
              />
            </DocumentSheet>
            <ChangeOrderResponse
              token={token}
              hash={shared.hash}
              status={shared.status}
              canSign={shared.scopes.includes("sign")}
              customerName={shared.customerName}
              businessName={shared.office.businessName}
            />
          </>
        ) : (
          <>
            <InvoiceSheet shared={shared} paper={paper} />
            <InvoiceResponse token={token} shared={shared} />
            {shared.contract ? (
              <a
                href={shared.contract.url}
                className="text-muted-foreground text-center text-xs underline underline-offset-4 print:hidden"
              >
                Your signed contract · {shared.contract.number}
              </a>
            ) : null}
          </>
        )}

        {canRequestChange && (
          <RequestChange token={token} businessName={shared.office.businessName} />
        )}
      </main>
    </div>
  );
}

/**
 * The shortcut in the bar — what she can do, when there's something to do.
 * The same conditions the panel below uses, said in two words.
 */
function respondLabel(shared: SharedDocument): string | null {
  if (shared.demo) return null;
  switch (shared.kind) {
    case "quote": {
      const today = new Date().toISOString().slice(0, 10);
      const open =
        shared.scopes.includes("accept") &&
        !["accepted", "declined", "expired"].includes(shared.status) &&
        !(shared.validUntil && shared.validUntil < today);
      if (!open) return null;
      return shared.signing ? signLabel(shared.draft) : approveLabel(shared.draft);
    }
    case "contract": {
      const contractor = shared.signatures.some((s) => s.party === "contractor");
      const customer = shared.signatures.some((s) => s.party === "customer");
      return contractor && !customer ? "Sign" : null;
    }
    case "change_order":
      return shared.status === "sent" && shared.scopes.includes("sign")
        ? "Approve or decline"
        : null;
    case "invoice":
      return !shared.voided && shared.outstandingCents > 0 && shared.scopes.includes("pay")
        ? `Pay ${formatMoney(shared.outstandingCents)}`
        : null;
  }
}
