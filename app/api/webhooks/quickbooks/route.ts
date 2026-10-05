import { createHmac, timingSafeEqual } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";

import { serverEnv } from "@/lib/env";
import { reportError } from "@/lib/observability";

/**
 * `POST /api/webhooks/quickbooks` — Intuit's change notifications.
 *
 * ## Why this exists at all, given the sync is one-way
 *
 * The brief is firm that we never pull QuickBooks edits back: two-way conflict
 * resolution is where accounting integrations die. So this endpoint does **not**
 * apply changes. What it is for is *knowing* — that the contractor's bookkeeper
 * deleted an invoice we pushed, or renamed a customer, or that the company was
 * disconnected from Intuit's side. Those are facts the sync-health surface has
 * to show, because a push that silently stops landing is the failure mode the
 * whole surface exists to prevent.
 *
 * ## Verification
 *
 * Intuit signs the raw body with a **webhook verifier token**, which is a
 * different secret from the client secret and is issued per app in the Intuit
 * dashboard. HMAC-SHA256, base64, in `intuit-signature`.
 *
 * The signature is over the exact bytes sent, so the body is read as text.
 * `request.json()` would re-serialize it and every check would fail.
 *
 * ## Answering fast
 *
 * Intuit retries and eventually disables an endpoint that is slow or failing,
 * so this acknowledges immediately and does the work behind the acknowledgement
 * rather than making Intuit wait on our database.
 */
export async function POST(request: NextRequest) {
  const { QUICKBOOKS_WEBHOOK_VERIFIER } = serverEnv();

  if (!QUICKBOOKS_WEBHOOK_VERIFIER) {
    // Not configured is not the caller's fault, but it is also not something
    // retrying fixes. 200 so Intuit does not disable the endpoint while the
    // deployment is still being set up.
    reportError("[quickbooks] QUICKBOOKS_WEBHOOK_VERIFIER is not set.");
    return NextResponse.json({ received: true, ignored: "unconfigured" });
  }

  const signature = request.headers.get("intuit-signature");
  if (!signature) {
    return NextResponse.json({ error: "Missing signature" }, { status: 401 });
  }

  const payload = await request.text();

  const expected = createHmac("sha256", QUICKBOOKS_WEBHOOK_VERIFIER)
    .update(payload)
    .digest("base64");

  const offered = Buffer.from(signature);
  const computed = Buffer.from(expected);

  if (
    offered.length !== computed.length ||
    !timingSafeEqual(offered, computed)
  ) {
    return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
  }

  let body: QuickBooksNotification;
  try {
    body = JSON.parse(payload) as QuickBooksNotification;
  } catch {
    return NextResponse.json({ error: "Malformed body" }, { status: 400 });
  }

  // Deliberately shallow for now. The entity mappers are stubs, so there is
  // nothing yet that could react to a change — recording that a notification
  // arrived, and for which company, is the honest amount of work to do until
  // there is. Building a reconciliation path against mappers that throw would
  // be building on a floor that is not there.
  for (const entry of body.eventNotifications ?? []) {
    const entities = entry.dataChangeEvent?.entities ?? [];
    console.info(
      `[quickbooks] realm ${entry.realmId}: ${entities.length} change(s) — ` +
        entities
          .map((entity) => `${entity.operation} ${entity.name} ${entity.id}`)
          .join(", ")
    );
  }

  return NextResponse.json({ received: true });
}

type QuickBooksNotification = {
  eventNotifications?: Array<{
    realmId: string;
    dataChangeEvent?: {
      entities?: Array<{
        name: string;
        id: string;
        operation: string;
        lastUpdated: string;
      }>;
    };
  }>;
};
