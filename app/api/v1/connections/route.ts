import { eq } from "drizzle-orm";

import { requireCaller, requireOrg } from "@/lib/api/auth";
import { handler } from "@/lib/api/handler";
import { ok } from "@/lib/api/response";
import { CONNECTORS, isConfigured } from "@/lib/connectors";
import { db } from "@/lib/db";
import { connections } from "@/lib/db/schema";

/**
 * `GET /api/v1/connections` — every slot, and what is in it.
 *
 * **The whole catalogue, not just what is connected.** A contractor who cannot
 * find QuickBooks concludes the product does not do QuickBooks; one who sees it
 * listed as not ready knows it is coming and stops looking. So the shape is one
 * row per connector with a nullable connection on it, rather than a list of
 * connections.
 *
 * **No token, ever.** This is a client-reachable endpoint and the secrets table
 * is not joined here — getting at a credential takes a deliberate call to
 * `lib/connectors/store`, on the server, which is the whole reason those
 * columns live in a table of their own.
 */
export const GET = handler(async (request) => {
  const caller = await requireCaller(request);
  const { organizationId } = await requireOrg(request, caller);

  const rows = await db
    .select({
      provider: connections.provider,
      status: connections.status,
      externalAccountName: connections.externalAccountName,
      scopes: connections.scopes,
      connectedAt: connections.connectedAt,
      lastHealthyAt: connections.lastHealthyAt,
      lastError: connections.lastError,
      lastErrorAt: connections.lastErrorAt,
    })
    .from(connections)
    .where(eq(connections.organizationId, organizationId));

  const byProvider = new Map(rows.map((row) => [row.provider, row]));

  return ok(
    CONNECTORS.map((connector) => {
      const live = byProvider.get(connector.id) ?? null;

      return {
        id: connector.id,
        kind: connector.kind,
        name: connector.name,
        summary: connector.summary,
        // Stated before connecting, not after. "Will it mess up my books?" is
        // the question that decides whether the button gets clicked.
        reads: connector.reads,
        writes: connector.writes,
        /**
         * Three states, and they are not the same question:
         * `available` — offered · `planned` — described, not built ·
         * `unconfigured` — built, but this deployment has no credentials.
         */
        availability:
          connector.status === "planned"
            ? ("planned" as const)
            : isConfigured(connector)
              ? ("available" as const)
              : ("unconfigured" as const),
        connection: live,
      };
    })
  );
});
