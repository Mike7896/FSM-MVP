import "server-only";

import { createHash, randomBytes } from "node:crypto";
import { and, eq, lt } from "drizzle-orm";

import { db } from "@/lib/db";
import { oauthStates } from "@/lib/db/schema";
import { absoluteUrl } from "@/lib/env";
import type { ConnectorProvider } from "./registry";

/**
 * The handshake, shared by every OAuth connector.
 *
 * ## What `state` is actually defending against
 *
 * Not the contractor's browser — the *contractor's Office*. Without a minted,
 * remembered, single-use state, an attacker can complete a handshake against
 * their own QuickBooks company and have the callback attach it to somebody
 * else's organization. Every subsequent invoice then syncs into the attacker's
 * books, and the contractor's books quietly stop receiving anything. The row is
 * the check, and it is deleted on use because a replayable state is not one.
 *
 * The row also carries **who started it**, so a callback opened in a different
 * signed-in session cannot complete a handshake the first person began.
 *
 * ## PKCE
 *
 * Used where the provider supports it. The verifier is a one-use secret with a
 * lifetime in minutes, which is why it sits in a column rather than needing the
 * encryption the long-lived tokens get.
 */

/** Long enough that a handshake survives a slow consent screen, short enough
 *  that an abandoned one is not a standing invitation. */
const STATE_TTL_MINUTES = 15;

export type MintedState = {
  state: string;
  codeVerifier: string | null;
  codeChallenge: string | null;
};

export async function mintState({
  organizationId,
  userId,
  provider,
  usePkce,
  returnTo,
}: {
  organizationId: string;
  userId: string;
  provider: ConnectorProvider;
  usePkce: boolean;
  returnTo?: string;
}): Promise<MintedState> {
  const state = randomBytes(32).toString("base64url");
  const codeVerifier = usePkce ? randomBytes(32).toString("base64url") : null;

  const codeChallenge = codeVerifier
    ? createHash("sha256").update(codeVerifier).digest("base64url")
    : null;

  await db.insert(oauthStates).values({
    state,
    organizationId,
    userId,
    provider,
    codeVerifier,
    // Only same-origin paths. An absolute URL here is an open redirect that
    // fires *after* a successful connection, which is the worst moment for one.
    returnTo:
      returnTo && returnTo.startsWith("/") && !returnTo.startsWith("//")
        ? returnTo
        : "/office/connections",
    expiresAt: new Date(Date.now() + STATE_TTL_MINUTES * 60_000),
  });

  return { state, codeVerifier, codeChallenge };
}

export type ConsumedState = {
  organizationId: string;
  userId: string;
  provider: ConnectorProvider;
  codeVerifier: string | null;
  returnTo: string;
};

/**
 * Reads a state and destroys it in one step.
 *
 * The delete is the consumption: two callbacks racing on the same state means
 * one of them is a replay, and only the row's first reader gets a result.
 */
export async function consumeState(
  state: string,
  expect: { provider: ConnectorProvider; userId: string }
): Promise<ConsumedState | null> {
  const [row] = await db
    .delete(oauthStates)
    .where(eq(oauthStates.state, state))
    .returning();

  if (!row) return null;
  if (row.expiresAt.getTime() < Date.now()) return null;
  if (row.provider !== expect.provider) return null;
  // A callback completed by a different signed-in user is not this handshake.
  if (row.userId !== expect.userId) return null;

  return {
    organizationId: row.organizationId,
    userId: row.userId,
    provider: row.provider,
    codeVerifier: row.codeVerifier,
    returnTo: row.returnTo ?? "/office/connections",
  };
}

/** Abandoned handshakes, swept by the same cron that drains the queue. */
export async function purgeExpiredStates(): Promise<number> {
  const rows = await db
    .delete(oauthStates)
    .where(lt(oauthStates.expiresAt, new Date()))
    .returning({ state: oauthStates.state });
  return rows.length;
}

/**
 * Every provider comes back to the same shaped address.
 *
 * Providers require redirect URIs to be registered ahead of time and matched
 * exactly, so this is the single place the string is built — a redirect URI
 * assembled at two call sites is a redirect URI that differs at one of them.
 */
export function callbackUrl(provider: ConnectorProvider): string {
  return absoluteUrl(`/api/connections/${provider}/callback`);
}

/** What a provider hands back once a code is exchanged. */
export type TokenSet = {
  accessToken: string;
  refreshToken: string | null;
  /** Seconds, as providers report it. */
  expiresIn: number | null;
  /** Only QuickBooks has one of these, and it is the reconnect deadline. */
  refreshTokenExpiresIn: number | null;
  scopes: string[];
  externalAccountId: string | null;
  externalAccountName: string | null;
};

/**
 * What every OAuth connector implements.
 *
 * Kept deliberately small. A provider adapter's whole job is to turn a
 * provider's dialect into this shape; anything larger belongs in that
 * provider's own module, and anything shared belongs here.
 */
export type OAuthAdapter = {
  provider: ConnectorProvider;
  usePkce: boolean;
  authorizeUrl(input: { state: string; codeChallenge: string | null }): string;
  exchangeCode(input: {
    code: string;
    codeVerifier: string | null;
    /** QuickBooks returns the company id as a query param, not in the token. */
    callbackParams: URLSearchParams;
  }): Promise<TokenSet>;
  refresh(refreshToken: string): Promise<TokenSet>;
  /** Best-effort. A provider that cannot revoke still gets disconnected here. */
  revoke?(input: { accessToken: string; refreshToken: string | null }): Promise<void>;
};

/**
 * A provider said no, and the contractor needs to know which kind of no.
 *
 * `reauth` means their action fixes it — the token expired, or they revoked
 * access from the provider's own settings. `provider` means the provider is
 * having a problem and retrying is right. `config` means we are missing
 * credentials, which is ours and never theirs.
 */
export type ConnectorErrorKind = "reauth" | "provider" | "config";

export class ConnectorError extends Error {
  /**
   * A branded discriminant, because `instanceof` is not safe here.
   *
   * This error decides whether a queued push **retries or dies**, and that
   * decision is made in a different module from the one that threw. Any bundler
   * that ends up with two copies of this file — a relative import in one place
   * and an aliased one in another, a server/client graph split, a script run
   * outside Next's resolver — gives two distinct classes, and `instanceof`
   * quietly answers false for one of them. The failure is invisible and
   * expensive: a revoked grant that should die on the first attempt instead
   * retries six times against somebody's accounting system.
   *
   * A property survives all of that.
   */
  readonly isConnectorError = true as const;

  constructor(
    readonly kind: ConnectorErrorKind,
    message: string,
    readonly cause?: unknown
  ) {
    super(message);
    this.name = "ConnectorError";
  }
}

/** Use this rather than `instanceof` — see the note above. */
export function isConnectorError(error: unknown): error is ConnectorError {
  return (
    typeof error === "object" &&
    error !== null &&
    (error as { isConnectorError?: unknown }).isConnectorError === true
  );
}

/**
 * A token request, with the failure modes named.
 *
 * Providers disagree about almost everything except that a token endpoint takes
 * form-encoded input and answers JSON, so the shared parts live here and the
 * dialect stays in the adapter.
 */
export async function postForm(
  url: string,
  body: Record<string, string>,
  headers: Record<string, string> = {}
): Promise<unknown> {
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Accept: "application/json",
      ...headers,
    },
    body: new URLSearchParams(body).toString(),
  });

  const text = await response.text();
  let parsed: unknown = null;
  try {
    parsed = text ? JSON.parse(text) : null;
  } catch {
    /* A provider erroring in HTML is still an error; the status decides. */
  }

  if (!response.ok) {
    const detail =
      (parsed as { error_description?: string; error?: string } | null)
        ?.error_description ??
      (parsed as { error?: string } | null)?.error ??
      text.slice(0, 200);

    // 400 on a refresh is the provider saying the grant is gone, which only the
    // contractor can undo. Retrying it forever is how a queue fills with rows
    // that will never succeed.
    throw new ConnectorError(
      response.status === 400 || response.status === 401
        ? "reauth"
        : "provider",
      detail || `Token request failed with ${response.status}.`
    );
  }

  return parsed;
}

/** Basic auth, which several providers require on the token endpoint. */
export function basicAuth(clientId: string, clientSecret: string): string {
  return `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString("base64")}`;
}

/** Deletes any state rows an organization abandoned for one provider. */
export async function clearStates(
  organizationId: string,
  provider: ConnectorProvider
) {
  await db
    .delete(oauthStates)
    .where(
      and(
        eq(oauthStates.organizationId, organizationId),
        eq(oauthStates.provider, provider)
      )
    );
}
