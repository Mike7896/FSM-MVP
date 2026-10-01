import { NextResponse, type NextRequest } from "next/server";

import { adapterFor, findConnector, isConfigured } from "@/lib/connectors";
import {
  createOnboardingLink,
  getOrCreateConnectedAccount,
} from "@/lib/stripe/connect";
import { mintState } from "@/lib/connectors/oauth";
import { encryptionConfigured } from "@/lib/connectors/crypto";
import { BILLING_ROLES, requireActiveOrganization, verifySession } from "@/lib/dal";
import { absoluteUrl } from "@/lib/env";
import { requireMembership } from "@/lib/dal";

/**
 * `GET /api/connections/[provider]/start` — begin a handshake.
 *
 * **A redirect, not an API call.** OAuth ends at a provider's consent screen in
 * the contractor's browser, so this is a plain navigation the connections page
 * links to. That also means every failure has to end somewhere a person can
 * read, which is why nothing here returns JSON — it sends them back to the
 * Office with a reason.
 *
 * **Owner and admin only.** Connecting an accounting system decides where this
 * business's invoices are posted. A technician doing it by accident is not a
 * settings mistake, it is somebody else's books receiving this shop's money.
 */
export async function GET(
  request: NextRequest,
  context: { params: Promise<{ provider: string }> }
) {
  const { provider } = await context.params;

  const back = (reason: string) =>
    NextResponse.redirect(
      absoluteUrl(`/office/connections?error=${encodeURIComponent(reason)}`)
    );

  const session = await verifySession();
  if (!session) {
    return NextResponse.redirect(
      absoluteUrl(`/login?next=${encodeURIComponent("/office/connections")}`)
    );
  }

  const connector = findConnector(provider);
  if (!connector) return back("unknown-connector");

  const org = await requireActiveOrganization();
  const membership = await requireMembership(org.id, BILLING_ROLES);
  if (!membership) return back("not-allowed");

  // Ours to get wrong, and worth saying plainly rather than letting the
  // contractor meet the provider's error page.
  if (!isConfigured(connector)) return back("not-configured");

  /**
   * The hosted path — no handshake, no credential.
   *
   * Stripe Connect accounts are *created* by this platform rather than linked,
   * so there is no consent screen and nothing to encrypt: we drive the account
   * with our own key and a `Stripe-Account` header. The shape is still a
   * redirect, and the connections page still links here, which is why this
   * lives in the same route rather than a second button somewhere else.
   *
   * The link Stripe returns is single-use and short-lived, so it is minted on
   * every visit. A contractor who abandoned the form yesterday taps the same
   * button today and picks up where he left off.
   */
  if (connector.handshake === "hosted") {
    if (connector.id !== "stripe_connect") return back("not-ready");

    const account = await getOrCreateConnectedAccount(org.id);
    return NextResponse.redirect(
      await createOnboardingLink(account, "/office/connections")
    );
  }

  // Only the credential-holding connectors need somewhere safe to put one.
  if (!encryptionConfigured()) return back("not-configured");

  const adapter = adapterFor(connector.id);
  if (!adapter) return back("not-ready");

  const { state, codeChallenge } = await mintState({
    organizationId: org.id,
    userId: session.userId,
    provider: connector.id,
    usePkce: adapter.usePkce,
    returnTo: "/office/connections",
  });

  return NextResponse.redirect(adapter.authorizeUrl({ state, codeChallenge }));
}
