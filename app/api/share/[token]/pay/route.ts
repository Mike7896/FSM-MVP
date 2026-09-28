import { NextResponse } from "next/server";

import { handlerWithParams } from "@/lib/api/handler";
import { ApiError, ok } from "@/lib/api/response";
import { clientEnv } from "@/lib/env";
import { resolvePayableInvoice } from "@/lib/queries/share";
import {
  applicationFeeCents,
  getConnectedAccount,
} from "@/lib/stripe/connect";
import { stripe } from "@/lib/stripe/server";

/**
 * The homeowner pays — Payment Rails §2.
 *
 * **No session, and there never will be one.** The token is the whole
 * authorization: possession is permission, the same capability-URL mechanism
 * that lets her approve a quote without an account. So the checks here are the
 * token's own — live, not revoked, not expired, and carrying the `pay` scope —
 * and the amount is computed server-side from the invoice and the ledger rather
 * than taken from the request. A client that could name its own amount could
 * pay a $9,000 invoice with a dollar.
 *
 * **This is a direct charge**, created on the contractor's connected account.
 * He is the merchant of record, his business name is on her statement, and a
 * dispute debits his balance rather than ours. Our revenue rides along as an
 * `application_fee_amount` that Stripe splits at the moment the money moves —
 * no invoicing, no collection step, and no customer funds in an account we
 * control.
 *
 * Capture is immediate. Separating authorization from capture suits businesses
 * whose final amount is unknown up front — hotels, fuel, equipment rental — and
 * a contractor's deposit is a known amount agreed in a signed document. Holding
 * the authorization would also expire it: seven days for a customer-initiated
 * online card, which is shorter than the gap between accepting a quote and
 * starting work.
 */
export const POST = handlerWithParams<{ token: string }>(
  async (_request, { token }) => {
    const invoice = await resolvePayableInvoice(token);

    // Unknown, revoked, expired, not an invoice, not payable, already settled.
    // All one answer: telling a stranger that a token *used* to be valid is
    // telling them a token exists.
    if (!invoice) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    const account = await getConnectedAccount(invoice.organizationId);
    if (!account?.chargesEnabled) {
      // His problem, not hers, and she can still pay him the way she always
      // could — so this says what is true without blaming her.
      throw new ApiError(
        "conflict",
        `${invoice.businessName ?? "This business"} isn't set up to take card ` +
          `payments yet. Get in touch with them to arrange payment.`
      );
    }

    const amountCents = invoice.outstandingCents;

    const intent = await stripe().paymentIntents.create(
      {
        amount: amountCents,
        currency: invoice.currency,
        // Stripe splits this out as the money moves. Zero is a legitimate
        // value — a platform may monetize on subscription alone — and Stripe
        // rejects the field at zero, hence the conditional.
        ...(applicationFeeCents(amountCents, account) > 0
          ? { application_fee_amount: applicationFeeCents(amountCents, account) }
          : {}),
        automatic_payment_methods: { enabled: true },
        // Attribution the webhook reads back. Verified against the shop on the
        // way in rather than trusted, because metadata is editable in the
        // Stripe Dashboard.
        metadata: {
          organizationId: invoice.organizationId,
          jobId: invoice.jobId,
          invoiceId: invoice.invoiceId,
          customerId: invoice.customerId,
        },
        description: `Invoice from ${invoice.businessName ?? "your contractor"}`,
      },
      // The header that makes this a direct charge on his account.
      { stripeAccount: account.stripeAccountId }
    );

    if (!intent.client_secret) {
      throw new ApiError("internal", "Stripe did not return a client secret.");
    }

    return ok({
      clientSecret: intent.client_secret,
      amountCents,
      currency: invoice.currency,
      businessName: invoice.businessName,
      /**
       * Stripe.js has to be initialized against the connected account for a
       * direct charge — `loadStripe(key, { stripeAccount })`. Without it the
       * browser confirms the intent on the platform account and fails with an
       * error that names neither problem.
       */
      stripeAccount: account.stripeAccountId,
      publishableKey: clientEnv.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY,
    });
  }
);
