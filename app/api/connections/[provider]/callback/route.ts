import { NextResponse, type NextRequest } from "next/server";

import { adapterFor, findConnector } from "@/lib/connectors";
import { consumeState, isConnectorError } from "@/lib/connectors/oauth";
import { saveConnection } from "@/lib/connectors/store";
import { verifySession } from "@/lib/dal";
import { absoluteUrl } from "@/lib/env";
import { reportError } from "@/lib/observability";

/**
 * `GET /api/connections/[provider]/callback` — finish a handshake.
 *
 * ## What this endpoint is actually guarding
 *
 * Not the browser — the **Office**. Without a minted, remembered, single-use
 * state, somebody can complete a handshake against *their* accounting company
 * and have it attached to *this* contractor's organization. Every invoice then
 * syncs into a stranger's books while the contractor's own quietly receive
 * nothing. So the state is looked up and destroyed in one step, it must name
 * the same provider this route serves, and it must have been started by the
 * person now standing here.
 *
 * The organization comes **from the stored state, never from the request**. A
 * callback that could name its own organization is the same vulnerability
 * wearing a different parameter.
 *
 * ## Everything ends somewhere readable
 *
 * A person is looking at this. Every path redirects to the Office with a plain
 * reason rather than rendering JSON at somebody who just clicked "Connect".
 */
export async function GET(
  request: NextRequest,
  context: { params: Promise<{ provider: string }> }
) {
  const { provider } = await context.params;
  const params = new URL(request.url).searchParams;

  const back = (query: string) =>
    NextResponse.redirect(absoluteUrl(`/office/connections?${query}`));

  const connector = findConnector(provider);
  if (!connector) return back("error=unknown-connector");

  // The contractor changed their mind on the provider's screen. Not an error,
  // and telling them it was one would be the app arguing with a decision.
  if (params.get("error")) {
    return back("cancelled=1");
  }

  const code = params.get("code");
  const state = params.get("state");
  if (!code || !state) return back("error=incomplete");

  const session = await verifySession();
  if (!session) {
    return NextResponse.redirect(
      absoluteUrl(`/login?next=${encodeURIComponent("/office/connections")}`)
    );
  }

  const consumed = await consumeState(state, {
    provider: connector.id,
    userId: session.userId,
  });
  if (!consumed) return back("error=expired");

  const adapter = adapterFor(connector.id);
  if (!adapter) return back("error=not-ready");

  try {
    const tokens = await adapter.exchangeCode({
      code,
      codeVerifier: consumed.codeVerifier,
      callbackParams: params,
    });

    await saveConnection({
      organizationId: consumed.organizationId,
      provider: connector.id,
      tokens,
    });
  } catch (error) {
    const reason =
      isConnectorError(error) && error.kind === "config"
        ? "not-configured"
        : "exchange-failed";

    reportError(`[connectors] ${provider} callback failed:`, error);
    return back(`error=${reason}`);
  }

  return NextResponse.redirect(
    absoluteUrl(`${consumed.returnTo}?connected=${connector.id}`)
  );
}
