import { NextResponse, type NextRequest } from "next/server";

import { refuseUnlessCron } from "@/lib/api/cron";
import { adapterFor } from "@/lib/connectors";
import { purgeExpiredStates } from "@/lib/connectors/oauth";
import {
  claimDue,
  fail,
  succeed,
  type ClaimedJob,
} from "@/lib/connectors/queue";
import { QUICKBOOKS_OPERATIONS } from "@/lib/connectors/quickbooks/push";
import {
  getAccessToken,
  getConnection,
  markHealthy,
  markNeedsReauth,
  markUnhealthy,
} from "@/lib/connectors/store";
import { ConnectorError, isConnectorError } from "@/lib/connectors/oauth";

/**
 * `POST /api/cron/sync` — drain the outbound queue.
 *
 * Triggered by Vercel Cron (`vercel.json`). A DB-backed queue rather than a
 * queue service, because it needs no new vendor, runs on the deploy that
 * already exists, and is inspectable in SQL when something goes wrong — which
 * is the moment you most want to be able to look.
 *
 * ## The bearer check is not optional
 *
 * Without it this is an open endpoint that makes this deployment push to every
 * connected provider on demand: a denial-of-service against other people's
 * accounting systems, from our IP, with our credentials. Compared in constant
 * time, because a `===` leaks the secret's prefix to anyone willing to send a
 * few thousand requests.
 *
 * ## Claiming, not scanning
 *
 * Vercel will invoke a cron route again while the previous run is still going.
 * `claimDue` marks rows in flight inside the same statement that selects them,
 * with `for update skip locked`, so two overlapping drains never take the same
 * row — and a double-claimed invoice push is a double-billed customer.
 *
 * ## One failure never stops the batch
 *
 * Each job is caught on its own. A revoked QuickBooks grant on one shop must
 * not stop another shop's invoice going out, so the loop records the failure
 * against that job and that connection, and carries on.
 */

/** Long enough for a batch of real HTTP calls, short of the platform ceiling. */
export const maxDuration = 60;

const BATCH = 20;

export async function POST(request: NextRequest) {
  const refused = refuseUnlessCron(request);
  if (refused) return refused;

  const purged = await purgeExpiredStates();
  const jobs = await claimDue(BATCH);

  let succeeded = 0;
  let retrying = 0;
  let dead = 0;

  for (const job of jobs) {
    try {
      const remoteId = await run(job);
      await succeed(job.id, remoteId);
      succeeded += 1;
    } catch (error) {
      const outcome = await fail(job, error);
      if (outcome === "dead") dead += 1;
      else retrying += 1;

      await recordAgainstConnection(job, error).catch(() => {});
    }
  }

  return NextResponse.json({
    claimed: jobs.length,
    succeeded,
    retrying,
    dead,
    purgedOauthStates: purged,
  });
}

/**
 * Vercel Cron sends GET on some plans and POST on others; both are the same
 * work and both are behind the same bearer check.
 */
export const GET = POST;

async function run(job: ClaimedJob): Promise<string | null> {
  const connection = await getConnection(job.organizationId, job.provider);
  if (!connection) {
    // The contractor disconnected between the enqueue and the drain. Nothing to
    // push to, and nothing anybody needs to fix — this is `reauth` so the row
    // dies rather than retrying against a connection that no longer exists.
    throw new ConnectorError(
      "reauth",
      "That was disconnected before this could be sent."
    );
  }

  const adapter = adapterFor(job.provider);
  if (!adapter) {
    throw new ConnectorError(
      "config",
      `No adapter for ${job.provider} in this build.`
    );
  }

  const accessToken = await getAccessToken(
    job.organizationId,
    job.provider,
    adapter
  );

  switch (job.provider) {
    case "quickbooks": {
      const mapper = QUICKBOOKS_OPERATIONS[job.operation];
      if (!mapper) {
        throw new ConnectorError(
          "config",
          `Unknown QuickBooks operation "${job.operation}".`
        );
      }
      if (!connection.externalAccountId) {
        throw new ConnectorError(
          "reauth",
          "We don't know which QuickBooks company this is. Reconnect it."
        );
      }

      const result = await mapper(job, {
        organizationId: job.organizationId,
        realmId: connection.externalAccountId,
        accessToken,
        idempotencyKey: job.idempotencyKey,
      });

      await markHealthy(connection.id);
      return result.remoteId;
    }

    default:
      throw new ConnectorError(
        "config",
        `${job.provider} has no push handler yet.`
      );
  }
}

/**
 * A failed push is also a fact about the connection.
 *
 * The Office shows connection health, and a contractor whose QuickBooks grant
 * lapsed needs to see that on the connections page rather than only on a row
 * buried in a sync list. `needs_reauth` is separated from a provider problem
 * because only one of them has an action attached.
 */
async function recordAgainstConnection(job: ClaimedJob, error: unknown) {
  const connection = await getConnection(job.organizationId, job.provider);
  if (!connection) return;

  if (isConnectorError(error) && error.kind === "reauth") {
    await markNeedsReauth(connection.id, error.message);
    return;
  }

  await markUnhealthy(
    connection.id,
    error instanceof Error
      ? error.message.slice(0, 300)
      : "A push didn't go through.",
    false
  );
}
