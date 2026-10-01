import { NextResponse } from "next/server";
import { z } from "zod";

import { handlerWithParams, readJson } from "@/lib/api/handler";
import { ok } from "@/lib/api/response";
import { clientEnv } from "@/lib/env";
import { startPaymentAttempt } from "@/lib/stripe/collect";

/**
 * The homeowner pays — Payment Rails §2, Billing §8.
 *
 * **No session, and there never will be one.** The token is the whole
 * authorization: possession is permission. The checks are the token's own —
 * live, not revoked, not expired, carrying the `pay` scope — and the amount
 * is computed server-side from the invoice, the ledger and any payment still
 * processing, never taken from the request.
 *
 * **She picks the rail first** — card or bank — and the PaymentIntent is made
 * for that rail alone, so ServiceClerk's fee is decided here from trusted
 * records: nothing on a card, 0.2% capped at $5 on ACH, taken from the
 * contractor's proceeds. She pays the invoice amount either way.
 *
 * **A direct charge**, on the contractor's connected account: he is the
 * merchant of record and a dispute debits his balance. Capture is immediate —
 * a deposit is a known amount agreed in a signed document.
 */

const bodySchema = z.object({
  rail: z.enum(["card", "ach"]).default("card"),
});

export const POST = handlerWithParams<{ token: string }>(
  async (request, { token }) => {
    const { rail } = await readJson(request, bodySchema);
    const started = await startPaymentAttempt(token, rail);

    // Unknown, revoked, expired, not an invoice, not payable, already settled.
    // All one answer: telling a stranger a token *used* to be valid tells
    // them a token exists.
    if (!started) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    return ok({
      clientSecret: started.clientSecret,
      amountCents: started.amountCents,
      rail,
      currency: started.invoice.currency,
      businessName: started.invoice.businessName,
      /**
       * Stripe.js has to be initialized against the connected account for a
       * direct charge — `loadStripe(key, { stripeAccount })`.
       */
      stripeAccount: started.account.stripeAccountId,
      publishableKey: clientEnv.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY,
    });
  }
);
