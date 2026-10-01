import "server-only";

import { cache } from "react";
import { eq } from "drizzle-orm";

import { db } from "@/lib/db";
import { connections } from "@/lib/db/schema";
import { CONNECTORS, isConfigured, type Connector } from "@/lib/connectors";
import { encryptionConfigured } from "@/lib/connectors/crypto";
import { queueHealth } from "@/lib/connectors/queue";

/**
 * The Office's connections, read.
 *
 * **Every connector, always — connected or not.** A contractor who cannot find
 * QuickBooks concludes the product does not do QuickBooks. So the shape is one
 * row per connector with a nullable connection on it, rather than a list of
 * connections, and the empty state is the catalogue rather than a blank page.
 *
 * **No secret is joined here.** `connection_secrets` is a separate table for
 * exactly this reason: a page that renders health must not be one credential
 * away from rendering a token.
 */

export type ConnectionAvailability =
  /** Built, credentialed, offerable. */
  | "available"
  /** Described in the registry, not built. */
  | "planned"
  /** Built, but this deployment has no credentials for it. */
  | "unconfigured";

export type ConnectionRow = {
  connector: Connector;
  availability: ConnectionAvailability;
  connection: {
    status: (typeof connections.status.enumValues)[number];
    accountName: string | null;
    connectedAt: Date;
    lastHealthyAt: Date | null;
    lastError: string | null;
  } | null;
  /** How much is queued for this provider, and how much has given up. */
  pending: number;
  stuck: number;
};

export const listConnections = cache(
  async (organizationId: string): Promise<ConnectionRow[]> => {
    const [rows, health] = await Promise.all([
      db
        .select({
          provider: connections.provider,
          status: connections.status,
          accountName: connections.externalAccountName,
          connectedAt: connections.connectedAt,
          lastHealthyAt: connections.lastHealthyAt,
          lastError: connections.lastError,
        })
        .from(connections)
        .where(eq(connections.organizationId, organizationId)),
      queueHealth(organizationId),
    ]);

    const live = new Map(rows.map((row) => [row.provider, row]));

    return CONNECTORS.map((connector) => {
      const row = live.get(connector.id) ?? null;

      const forProvider = health.filter(
        (entry) => entry.provider === connector.id
      );

      return {
        connector,
        availability:
          connector.status === "planned"
            ? "planned"
            : // Credentials for the provider, *and* a key to encrypt what comes
              // back. Missing either one means the button cannot work, and a
              // button that cannot work is worse than one that says why.
              //
              // A `hosted` connector is exempt from the second half: it never
              // receives a credential, so there is nothing to encrypt and an
              // absent encryption key must not hide a payment setup that would
              // work perfectly well.
              isConfigured(connector) &&
                (connector.handshake === "hosted" || encryptionConfigured())
              ? "available"
              : "unconfigured",
        connection: row
          ? {
              status: row.status,
              accountName: row.accountName,
              connectedAt: row.connectedAt,
              lastHealthyAt: row.lastHealthyAt,
              lastError: row.lastError,
            }
          : null,
        pending: forProvider
          .filter((entry) => entry.status !== "dead")
          .reduce((sum, entry) => sum + entry.count, 0),
        stuck: forProvider
          .filter((entry) => entry.status === "dead")
          .reduce((sum, entry) => sum + entry.count, 0),
      };
    });
  }
);
