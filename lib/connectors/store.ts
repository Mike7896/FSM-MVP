import "server-only";

import { and, eq } from "drizzle-orm";

import { db } from "@/lib/db";
import { connectionSecrets, connections } from "@/lib/db/schema";
import { decryptSecret, encryptSecret } from "./crypto";
import {
  ConnectorError,
  isConnectorError,
  type OAuthAdapter,
  type TokenSet,
} from "./oauth";
import { findConnector, type ConnectorProvider } from "./registry";

/**
 * The only module that touches a connector credential.
 *
 * **Nothing else in the codebase decrypts a token.** Product code asks this
 * module for an authorized fetch and gets one; it never sees a bearer string,
 * which is what keeps an access token out of a Server Component's props by
 * accident. The token columns live in their own table for the same reason
 * (`connections.ts`): a secret is never in a row anything else selects.
 */

/**
 * Refresh this far ahead of expiry rather than on a 401.
 *
 * A 401 in the middle of a push is a failed push to retry, and retries are
 * expensive when the thing on the other end is somebody's books. Five minutes
 * covers clock skew between us and the provider with room to spare.
 */
const REFRESH_MARGIN_MS = 5 * 60_000;

export type StoredConnection = {
  id: string;
  organizationId: string;
  provider: ConnectorProvider;
  externalAccountId: string | null;
  externalAccountName: string | null;
  status: (typeof connections.status.enumValues)[number];
  settings: Record<string, unknown> | null;
};

/**
 * Writes a completed handshake.
 *
 * **Reconnecting the same provider updates the row rather than adding one.** A
 * second row for the same Office and provider is two connections nobody can
 * tell apart and a push that goes to whichever one a query happened to order
 * first.
 *
 * The upsert deliberately clears `lastError` and resets status: whatever was
 * wrong before, a fresh grant is the fix, and a page still showing last week's
 * failure after a successful reconnect is a page nobody believes.
 */
export async function saveConnection({
  organizationId,
  provider,
  tokens,
}: {
  organizationId: string;
  provider: ConnectorProvider;
  tokens: TokenSet;
}): Promise<StoredConnection> {
  const connector = findConnector(provider);
  if (!connector) {
    throw new ConnectorError("config", `Unknown connector "${provider}".`);
  }

  const now = Date.now();

  const [row] = await db
    .insert(connections)
    .values({
      organizationId,
      provider,
      kind: connector.kind,
      status: "connected",
      externalAccountId: tokens.externalAccountId,
      externalAccountName: tokens.externalAccountName,
      scopes: tokens.scopes,
      connectedAt: new Date(now),
      lastHealthyAt: new Date(now),
      lastError: null,
      lastErrorAt: null,
    })
    .onConflictDoUpdate({
      target: [connections.organizationId, connections.provider],
      set: {
        status: "connected",
        externalAccountId: tokens.externalAccountId,
        externalAccountName: tokens.externalAccountName,
        scopes: tokens.scopes,
        connectedAt: new Date(now),
        lastHealthyAt: new Date(now),
        lastError: null,
        lastErrorAt: null,
        updatedAt: new Date(now),
      },
    })
    .returning();

  await writeTokens(row.id, tokens);

  return {
    id: row.id,
    organizationId: row.organizationId,
    provider: row.provider,
    externalAccountId: row.externalAccountId,
    externalAccountName: row.externalAccountName,
    status: row.status,
    settings: row.settings,
  };
}

async function writeTokens(connectionId: string, tokens: TokenSet) {
  const values = {
    accessToken: encryptSecret(tokens.accessToken),
    refreshToken: tokens.refreshToken
      ? encryptSecret(tokens.refreshToken)
      : null,
    accessTokenExpiresAt: tokens.expiresIn
      ? new Date(Date.now() + tokens.expiresIn * 1000)
      : null,
    refreshTokenExpiresAt: tokens.refreshTokenExpiresIn
      ? new Date(Date.now() + tokens.refreshTokenExpiresIn * 1000)
      : null,
    updatedAt: new Date(),
  };

  await db
    .insert(connectionSecrets)
    .values({ connectionId, ...values })
    .onConflictDoUpdate({
      target: connectionSecrets.connectionId,
      set: values,
    });
}

export async function getConnection(
  organizationId: string,
  provider: ConnectorProvider
): Promise<StoredConnection | null> {
  const [row] = await db
    .select({
      id: connections.id,
      organizationId: connections.organizationId,
      provider: connections.provider,
      externalAccountId: connections.externalAccountId,
      externalAccountName: connections.externalAccountName,
      status: connections.status,
      settings: connections.settings,
    })
    .from(connections)
    .where(
      and(
        eq(connections.organizationId, organizationId),
        eq(connections.provider, provider)
      )
    )
    .limit(1);

  return row ?? null;
}

/**
 * A live access token, refreshed if it is close to expiry.
 *
 * **The rotated refresh token is persisted before this returns.** QuickBooks
 * invalidates the previous refresh token the instant it issues a new one, so a
 * refresh whose result is not written has destroyed the connection rather than
 * renewed it. The write is therefore part of the refresh, not a follow-up, and
 * a failed write is reported as a failed refresh.
 */
export async function getAccessToken(
  organizationId: string,
  provider: ConnectorProvider,
  adapter: OAuthAdapter
): Promise<string> {
  const [row] = await db
    .select({
      connectionId: connections.id,
      status: connections.status,
      accessToken: connectionSecrets.accessToken,
      refreshToken: connectionSecrets.refreshToken,
      accessTokenExpiresAt: connectionSecrets.accessTokenExpiresAt,
    })
    .from(connections)
    .innerJoin(
      connectionSecrets,
      eq(connectionSecrets.connectionId, connections.id)
    )
    .where(
      and(
        eq(connections.organizationId, organizationId),
        eq(connections.provider, provider)
      )
    )
    .limit(1);

  if (!row) {
    throw new ConnectorError("reauth", "That isn't connected.");
  }
  if (row.status === "revoked") {
    throw new ConnectorError(
      "reauth",
      "That connection was disconnected. Reconnect it from the Office."
    );
  }

  const stillGood =
    row.accessTokenExpiresAt &&
    row.accessTokenExpiresAt.getTime() - REFRESH_MARGIN_MS > Date.now();

  if (stillGood) return decryptSecret(row.accessToken);

  if (!row.refreshToken) {
    throw new ConnectorError(
      "reauth",
      "That connection expired and can't renew itself. Reconnect it from the Office."
    );
  }

  let refreshed: TokenSet;
  try {
    refreshed = await adapter.refresh(decryptSecret(row.refreshToken));
  } catch (error) {
    if (isConnectorError(error) && error.kind === "reauth") {
      await markNeedsReauth(
        row.connectionId,
        "The connection expired. Reconnect it and nothing else changes."
      );
    }
    throw error;
  }

  await writeTokens(row.connectionId, refreshed);
  await db
    .update(connections)
    .set({
      status: "connected",
      lastHealthyAt: new Date(),
      lastError: null,
      lastErrorAt: null,
      updatedAt: new Date(),
    })
    .where(eq(connections.id, row.connectionId));

  return refreshed.accessToken;
}

/** Something the contractor can fix, said the way they need to hear it. */
export async function markNeedsReauth(connectionId: string, message: string) {
  await db
    .update(connections)
    .set({
      status: "needs_reauth",
      lastError: message,
      lastErrorAt: new Date(),
      updatedAt: new Date(),
    })
    .where(eq(connections.id, connectionId));
}

/**
 * Something went wrong that is not the contractor's to fix.
 *
 * **Silent failure corrupts books and trust**, so a provider error is recorded
 * against the connection and surfaced rather than swallowed into a log nobody
 * reads. `degraded` rather than `error` while retries are still pending: the
 * push has not failed yet, it is late.
 */
export async function markUnhealthy(
  connectionId: string,
  message: string,
  fatal = false
) {
  await db
    .update(connections)
    .set({
      status: fatal ? "error" : "degraded",
      lastError: message,
      lastErrorAt: new Date(),
      updatedAt: new Date(),
    })
    .where(eq(connections.id, connectionId));
}

export async function markHealthy(connectionId: string) {
  await db
    .update(connections)
    .set({
      status: "connected",
      lastHealthyAt: new Date(),
      lastError: null,
      lastErrorAt: null,
      updatedAt: new Date(),
    })
    .where(eq(connections.id, connectionId));
}

/**
 * Disconnect.
 *
 * **The row goes; the external refs stay.** What we already pushed still exists
 * in the contractor's books with our ids on it, and forgetting the mapping
 * would mean a later reconnect creates a second copy of every customer and
 * invoice. Deleting somebody's accounting records to tidy up our own table is
 * not a trade this product makes — the brief's rule is *never delete in the
 * provider*, and this is the same rule pointed the other way.
 */
export async function disconnect(
  organizationId: string,
  provider: ConnectorProvider,
  adapter?: OAuthAdapter
): Promise<boolean> {
  const [row] = await db
    .select({
      id: connections.id,
      accessToken: connectionSecrets.accessToken,
      refreshToken: connectionSecrets.refreshToken,
    })
    .from(connections)
    .leftJoin(
      connectionSecrets,
      eq(connectionSecrets.connectionId, connections.id)
    )
    .where(
      and(
        eq(connections.organizationId, organizationId),
        eq(connections.provider, provider)
      )
    )
    .limit(1);

  if (!row) return false;

  // Best effort, and deliberately not awaited into the failure path: a provider
  // that will not accept a revoke must not leave the contractor unable to
  // disconnect on our side.
  if (adapter?.revoke && row.accessToken) {
    await adapter
      .revoke({
        accessToken: decryptSecret(row.accessToken),
        refreshToken: row.refreshToken ? decryptSecret(row.refreshToken) : null,
      })
      .catch((error) => {
        console.error(`[connectors] revoke failed for ${provider}:`, error);
      });
  }

  // Cascades to `connection_secrets`; leaves `external_refs` alone on purpose.
  await db.delete(connections).where(eq(connections.id, row.id));
  return true;
}
