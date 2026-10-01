import { z } from "zod";
import { NextResponse } from "next/server";

import { requireCaller, requireOrg } from "@/lib/api/auth";
import { handler, readJson } from "@/lib/api/handler";
import { ApiError, ok } from "@/lib/api/response";
import {
  createOnboardingLink,
  getOrCreateConnectedAccount,
} from "@/lib/stripe/connect";

/**
 * "Set up payments" — Payment Rails §4.
 *
 * The contractor arrives with no Stripe relationship and leaves able to charge,
 * without visiting an external signup page or managing a second vendor. This
 * route creates the connected account if it does not exist, then mints a
 * one-time link to Stripe's hosted form.
 *
 * **The link is single-use and expires**, which is why it is minted per request
 * rather than stored. A contractor who abandons the form halfway and comes back
 * tomorrow taps the same button and gets a fresh one; the account underneath is
 * the same account, and his progress on it is preserved by Stripe.
 *
 * Gated to owner and admin. A technician setting up where the shop's money
 * lands is not a permission anybody meant to grant.
 */

const bodySchema = z.object({
  organizationId: z.uuid().optional(),
  /** Where Stripe returns him. Must be a path on our own site. */
  returnTo: z.string().startsWith("/").optional(),
});

export const POST = handler(async (request) => {
  const caller = await requireCaller(request);
  const body = await readJson(request, bodySchema);

  const { organizationId } = await requireOrg(request, caller, {
    organizationId: body.organizationId,
    roles: ["owner", "admin"],
  });

  const account = await getOrCreateConnectedAccount(organizationId);
  const url = await createOnboardingLink(account, body.returnTo);

  return ok({ url, status: account.status });
});

/**
 * Where Stripe sends him when a link expires before he finishes.
 *
 * It has to mint a new one and bounce him back into the form rather than render
 * an error — an expired link is not a failure, it is a link that did its job
 * and timed out, and a contractor who sees "something went wrong" here concludes
 * the product cannot take payments.
 *
 * A GET rather than the POST above because Stripe navigates the browser here,
 * which means the cookie session is the only credential available.
 */
export const GET = handler(async (request) => {
  const caller = await requireCaller(request);
  const { organizationId } = await requireOrg(request, caller, {
    roles: ["owner", "admin"],
  });

  const account = await getOrCreateConnectedAccount(organizationId);

  if (account.detailsSubmitted) {
    // He finished after all — the link expired between submitting and landing
    // here. Sending him back into the form would ask for it all again.
    return NextResponse.redirect(
      new URL("/office/connections?connect=complete", request.url)
    );
  }

  const url = await createOnboardingLink(account);
  if (!url) throw new ApiError("internal", "Stripe did not return a link.");

  return NextResponse.redirect(url);
});
