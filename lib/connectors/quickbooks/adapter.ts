import "server-only";

import { serverEnv } from "@/lib/env";
import {
  ConnectorError,
  basicAuth,
  callbackUrl,
  postForm,
  type OAuthAdapter,
  type TokenSet,
} from "../oauth";

/**
 * QuickBooks Online — OAuth 2.0 authorization code flow.
 *
 * ## The three facts that shape every line below
 *
 * **1. The refresh token rotates on every use, and the old one dies.** Intuit
 * returns a new refresh token from each refresh call and immediately
 * invalidates the previous one. A refresh whose result is not persisted has
 * therefore *destroyed* the connection rather than renewed it — so the write
 * happens before the new access token is handed to a caller, and a failed write
 * is a failed refresh.
 *
 * **2. The refresh token expires at about 100 days.** Not on inactivity — on a
 * clock. A shop that goes quiet over winter comes back to a dead connection
 * unless something refreshed in the meantime, which is why the queue drain
 * refreshes on a schedule rather than only when there is something to push, and
 * why `refreshTokenExpiresAt` is stored so the reconnect prompt can be raised
 * *before* the deadline rather than after the first failure.
 *
 * **3. `realmId` arrives as a query parameter on the callback, not in the token
 * response.** It is the company id, it is required in the path of every
 * subsequent API call, and it is the only way to tell "reconnected the same
 * company" from "connected a different one" — which is a data-corruption
 * question, because pushing this shop's invoices into a different company's
 * books is not recoverable by us.
 *
 * ## Scope
 *
 * `com.intuit.quickbooks.accounting` only. The payments scope is deliberately
 * absent: this product does not move money through QuickBooks, and asking for a
 * permission we never use is exactly the thing that makes a contractor's
 * accountant say no on their behalf.
 */

const AUTHORIZE_URL = "https://appcenter.intuit.com/connect/oauth2";
const TOKEN_URL = "https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer";
const REVOKE_URL = "https://developer.api.intuit.com/v2/oauth2/tokens/revoke";

export const QUICKBOOKS_SCOPES = ["com.intuit.quickbooks.accounting"];

/** The API host differs by environment; the path shape does not. */
export function quickbooksApiBase(): string {
  return serverEnv().QUICKBOOKS_ENVIRONMENT === "production"
    ? "https://quickbooks.api.intuit.com"
    : "https://sandbox-quickbooks.api.intuit.com";
}

function credentials() {
  const { QUICKBOOKS_CLIENT_ID, QUICKBOOKS_CLIENT_SECRET } = serverEnv();
  if (!QUICKBOOKS_CLIENT_ID || !QUICKBOOKS_CLIENT_SECRET) {
    throw new ConnectorError(
      "config",
      "QuickBooks isn't set up on this deployment yet."
    );
  }
  return {
    clientId: QUICKBOOKS_CLIENT_ID,
    clientSecret: QUICKBOOKS_CLIENT_SECRET,
  };
}

type IntuitTokenResponse = {
  access_token: string;
  refresh_token: string;
  expires_in: number;
  x_refresh_token_expires_in?: number;
  token_type: string;
};

function toTokenSet(
  raw: unknown,
  realmId: string | null,
  companyName: string | null
): TokenSet {
  const body = raw as IntuitTokenResponse | null;

  if (!body?.access_token || !body?.refresh_token) {
    throw new ConnectorError(
      "provider",
      "QuickBooks answered without a token. Try connecting again."
    );
  }

  return {
    accessToken: body.access_token,
    refreshToken: body.refresh_token,
    expiresIn: body.expires_in ?? null,
    refreshTokenExpiresIn: body.x_refresh_token_expires_in ?? null,
    scopes: QUICKBOOKS_SCOPES,
    externalAccountId: realmId,
    externalAccountName: companyName,
  };
}

export const quickbooksAdapter: OAuthAdapter = {
  provider: "quickbooks",
  // Intuit's web flow is a confidential-client code exchange; PKCE is not part
  // of it, and sending a challenge it does not expect is a rejected request.
  usePkce: false,

  authorizeUrl({ state }) {
    const { clientId } = credentials();
    const params = new URLSearchParams({
      client_id: clientId,
      response_type: "code",
      scope: QUICKBOOKS_SCOPES.join(" "),
      redirect_uri: callbackUrl("quickbooks"),
      state,
    });
    return `${AUTHORIZE_URL}?${params.toString()}`;
  },

  async exchangeCode({ code, callbackParams }) {
    const { clientId, clientSecret } = credentials();

    // The company id rides on the callback URL, not in the token body. Without
    // it there is nothing to address, so a handshake that loses it is a failed
    // handshake rather than a connection with a gap.
    const realmId = callbackParams.get("realmId");
    if (!realmId) {
      throw new ConnectorError(
        "provider",
        "QuickBooks didn't say which company was connected. Try again from the Office."
      );
    }

    const raw = await postForm(
      TOKEN_URL,
      {
        grant_type: "authorization_code",
        code,
        redirect_uri: callbackUrl("quickbooks"),
      },
      { Authorization: basicAuth(clientId, clientSecret) }
    );

    const tokens = toTokenSet(raw, realmId, null);

    // The name is what the contractor recognises on the connections page, and
    // it is worth one extra call at connect time so the row never reads as an
    // opaque id. A failure here is cosmetic, so it must not fail the connect.
    const companyName = await fetchCompanyName(
      tokens.accessToken,
      realmId
    ).catch(() => null);

    return { ...tokens, externalAccountName: companyName };
  },

  async refresh(refreshToken) {
    const { clientId, clientSecret } = credentials();

    const raw = await postForm(
      TOKEN_URL,
      { grant_type: "refresh_token", refresh_token: refreshToken },
      { Authorization: basicAuth(clientId, clientSecret) }
    );

    // realmId is unchanged by a refresh, so the caller keeps the one it stored.
    return toTokenSet(raw, null, null);
  },

  async revoke({ accessToken, refreshToken }) {
    const { clientId, clientSecret } = credentials();

    // Intuit accepts either token; the refresh token is the one worth killing
    // because it is the long-lived grant.
    await fetch(REVOKE_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        Authorization: basicAuth(clientId, clientSecret),
      },
      body: JSON.stringify({ token: refreshToken ?? accessToken }),
    });
  },
};

/**
 * The company's own name, for the connections page.
 *
 * Deliberately tolerant: a connection whose display name failed to load is
 * still a working connection, and refusing the whole handshake over a label
 * would be the worst possible trade.
 */
async function fetchCompanyName(
  accessToken: string,
  realmId: string
): Promise<string | null> {
  const response = await fetch(
    `${quickbooksApiBase()}/v3/company/${realmId}/companyinfo/${realmId}?minorversion=75`,
    {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: "application/json",
      },
    }
  );

  if (!response.ok) return null;

  const body = (await response.json()) as {
    CompanyInfo?: { CompanyName?: string };
  };
  return body.CompanyInfo?.CompanyName ?? null;
}
