/**
 * The connector layer, checked against a real database.
 *
 * Four things here are the ones that hurt when they are wrong, and none of them
 * is visible from a screen:
 *
 * - **Credentials round-trip, and tampering is caught.** A token stored under
 *   AES-256-GCM that decrypts to something *else* would be a request signed
 *   with an attacker's value; the authentication tag is what makes that
 *   impossible, so this flips a byte and checks it throws.
 * - **A duplicate enqueue is a no-op.** Document writes and webhooks both fire
 *   for one real event, so the idempotency index is what stops a corrected
 *   invoice becoming two invoices in somebody's books.
 * - **A claim is exclusive.** Vercel invokes a cron route again while the
 *   previous run is going. Two drains claiming the same row is a double-billed
 *   customer, so the second claim has to come back empty.
 * - **A permanent failure dies immediately.** Retrying a revoked grant cannot
 *   succeed, and a queue full of rows that will never work is a queue whose
 *   depth stops meaning anything.
 *
 * It writes a throwaway organization and cleans up in a `finally`.
 *
 *     npm run connector:check
 */

// `lib/db` and the connector modules guard themselves with `server-only`,
// which throws unless the resolver picks the react-server condition. This
// script *is* server code, so it runs with `--conditions=react-server`.

import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { organizations } from "@/lib/db/schema/office";
import { syncJobs } from "@/lib/db/schema/connections";
import { decryptSecret, encryptSecret, safeEqual } from "@/lib/connectors/crypto";
import { claimDue, enqueue, fail, succeed } from "@/lib/connectors/queue";
import { ConnectorError } from "@/lib/connectors/oauth";

let passed = 0;
const failures: string[] = [];

function check(label: string, condition: boolean, detail?: string) {
  if (condition) {
    passed += 1;
    console.log(`  ok   ${label}`);
  } else {
    failures.push(`${label}${detail ? ` — ${detail}` : ""}`);
    console.log(`  FAIL ${label}${detail ? ` — ${detail}` : ""}`);
  }
}

const slug = `connector-check-${Date.now()}`;
let organizationId = "";

try {
  console.log("\nCREDENTIAL ENCRYPTION");
  {
    const secret = "refresh-token-that-must-not-leak";
    const sealed = encryptSecret(secret);

    check("ciphertext is not the plaintext", !sealed.includes(secret));
    check("it round-trips", decryptSecret(sealed) === secret);
    check("it is versioned", sealed.startsWith("v1."));

    // Two encryptions of the same value must differ, or a repeated IV has been
    // reused — which under GCM leaks the keystream rather than merely weakening
    // it.
    check("a fresh IV every time", encryptSecret(secret) !== sealed);

    const [v, iv, tag, body] = sealed.split(".");
    const flipped = Buffer.from(body, "base64url");
    flipped[0] ^= 0xff;
    let caught = false;
    try {
      decryptSecret([v, iv, tag, flipped.toString("base64url")].join("."));
    } catch {
      caught = true;
    }
    check("tampering is rejected", caught);

    check("constant-time compare matches", safeEqual("abc", "abc"));
    check("...and rejects a different length", !safeEqual("abc", "abcd"));
  }

  const [org] = await db
    .insert(organizations)
    .values({ name: "Connector Check", slug })
    .returning();
  organizationId = org.id;

  console.log("\nQUEUE");
  {
    const first = await enqueue({
      organizationId,
      provider: "quickbooks",
      operation: "push_invoice",
      entity: "invoice",
      localId: "inv-1",
      idempotencyKey: "invoice:inv-1:v1",
    });
    check("a push queues", first !== null);

    // The same push, twice. This is the expected case rather than an error: a
    // document write and a webhook both fire for one real event.
    const duplicate = await enqueue({
      organizationId,
      provider: "quickbooks",
      operation: "push_invoice",
      entity: "invoice",
      localId: "inv-1",
      idempotencyKey: "invoice:inv-1:v1",
    });
    check("the same push doesn't queue twice", duplicate === null);

    // A *corrected* invoice is a different version and must get through.
    const revised = await enqueue({
      organizationId,
      provider: "quickbooks",
      operation: "push_invoice",
      entity: "invoice",
      localId: "inv-1",
      idempotencyKey: "invoice:inv-1:v2",
    });
    check("a corrected version does queue", revised !== null);

    const claimed = await claimDue(50);
    const mine = claimed.filter((job) => job.organizationId === organizationId);
    check("claiming picks up what is due", mine.length === 2, `${mine.length}`);
    check("a claim increments attempts", mine.every((job) => job.attempts === 1));

    // The second drain must come back empty for these rows.
    const second = await claimDue(50);
    const overlap = second.filter((job) =>
      mine.some((claimedJob) => claimedJob.id === job.id)
    );
    check("a second drain can't re-claim them", overlap.length === 0);

    const [retryable, permanent] = mine;

    const retryOutcome = await fail(retryable, new Error("provider hiccup"));
    check("a transient failure retries", retryOutcome === "retry");

    const [afterRetry] = await db
      .select()
      .from(syncJobs)
      .where(eq(syncJobs.id, retryable.id));
    check("...and is scheduled into the future", afterRetry.nextAttemptAt > new Date());
    check("...with the reason recorded", afterRetry.lastError === "provider hiccup");

    const deadOutcome = await fail(
      permanent,
      new ConnectorError("reauth", "The connection expired.")
    );
    check("a revoked grant dies on the first try", deadOutcome === "dead");

    const [afterDead] = await db
      .select()
      .from(syncJobs)
      .where(eq(syncJobs.id, permanent.id));
    check("...and is marked dead", afterDead.status === "dead");

    await succeed(retryable.id, "qbo-42");
    const [afterSuccess] = await db
      .select()
      .from(syncJobs)
      .where(eq(syncJobs.id, retryable.id));
    check("success records the remote id", afterSuccess.remoteId === "qbo-42");
    check("...and clears the error", afterSuccess.lastError === null);
  }
} finally {
  if (organizationId) {
    await db
      .delete(syncJobs)
      .where(and(eq(syncJobs.organizationId, organizationId)));
    await db.delete(organizations).where(eq(organizations.id, organizationId));
  }
}

console.log(
  `\n${passed} passed, ${failures.length} failed.` +
    (failures.length ? `\n\n${failures.map((f) => `  - ${f}`).join("\n")}\n` : "\n")
);

process.exit(failures.length ? 1 : 0);
