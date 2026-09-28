/**
 * The ledger, checked against a real database.
 *
 * Every rule here is one the *database* has to enforce, not the write path,
 * because "every caller goes through `recordEntry`" is a convention and this is
 * somebody's money. The point of this script is to prove the locks are real:
 *
 * - **Nothing is ever updated or deleted.** An audit trail you can edit is not
 *   one, and a dispute packet assembled from editable rows is worth nothing to
 *   an issuer.
 * - **A type carries its sign.** A `refund_issued` that landed positive would
 *   read as a collection and inflate what the homeowner appears to have paid.
 * - **A replay is a no-op.** Stripe delivers duplicate webhooks as normal
 *   operation, so the second delivery has to write nothing.
 * - **Two manual payments both survive.** This is the design brief's own bug:
 *   it specified `unique nulls not distinct`, which treats NULLs as *equal* and
 *   would have silently swallowed every cash payment after the first.
 * - **A reversal cancels exactly.** A reversal for the wrong amount is worse
 *   than no reversal, because it looks settled.
 *
 * Statements are written raw rather than through the schema module on purpose:
 * this tests the table the *migration* built, and a drift between the migration
 * and `lib/db/schema` is one of the things it is here to catch.
 *
 * Everything runs inside a transaction that is rolled back — which is also the
 * only way to clean up after a table whose DELETE is blocked by trigger.
 *
 *     npm run ledger:check
 */

// `lib/db` guards itself with `server-only`, which throws unless the resolver
// picks the react-server condition. This script *is* server code, so it runs
// with `--conditions=react-server`.

import { sql } from "drizzle-orm";
import type { PgTransaction } from "drizzle-orm/pg-core";

import { db } from "@/lib/db";

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

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Tx = PgTransaction<any, any, any>;

/**
 * Runs a statement and reports whether the database refused it.
 *
 * **Inside a savepoint**, and that is not an optimization. Postgres aborts the
 * whole transaction on the first error — every statement after it comes back
 * `25P02 current transaction is aborted` — so without a nested transaction the
 * first expected rejection would make every later check fail for a reason that
 * has nothing to do with what it was testing.
 */
async function refuses(
  label: string,
  tx: Tx,
  run: (t: Tx) => Promise<unknown>,
  expect?: RegExp
) {
  try {
    await tx.transaction(async (inner) => {
      await run(inner as Tx);
    });
    check(label, false, "the database allowed it");
  } catch (error) {
    // Drizzle wraps the driver error, and the constraint name is on the cause
    // rather than on the wrapper's own message.
    const message = error instanceof Error ? error.message : String(error);
    const cause = (error as { cause?: unknown }).cause;
    const text = cause instanceof Error ? `${message} ${cause.message}` : message;

    check(label, expect ? expect.test(text) : true, expect ? text : undefined);
  }
}

/** Thrown at the end of the transaction so nothing is kept. */
class Rollback extends Error {}

/**
 * An ISO string, not a `Date`.
 *
 * These statements are deliberately raw, so Drizzle's column-aware value
 * mappers never see them and the driver gets the parameter as-is — and
 * postgres.js will not serialize a `Date` for a parameter whose type it has not
 * been told. Application code never hits this, because it goes through the
 * schema module where `timestamp` knows what to do.
 */
const OCCURRED = "2026-08-14T12:00:00Z";

/**
 * One insert, with the column list built from the object's own keys.
 *
 * Column names are our own literals so `sql.raw` is safe for them; every value
 * is bound as a parameter, which is what lets an enum column infer its type
 * from the target rather than needing an explicit cast.
 */
function insert(tx: Tx, organizationId: string, values: Record<string, unknown>) {
  const row: Record<string, unknown> = {
    organization_id: organizationId,
    currency: "usd",
    occurred_at: OCCURRED,
    ...values,
  };

  const keys = Object.keys(row);
  const bound = sql.join(
    keys.map((key) => sql`${row[key]}`),
    sql`, `
  );

  return tx.execute<{ id: string; seq: string; amount_cents: string }>(
    sql`insert into ledger_entries (${sql.raw(keys.join(", "))})
        values (${bound})
        returning id, seq, amount_cents`
  );
}

try {
  await db
    .transaction(async (tx) => {
      const orgs = await tx.execute<{ id: string }>(
        sql`insert into organizations (name, slug)
            values ('Ledger Check', ${`ledger-check-${Date.now()}`})
            returning id`
      );
      const organizationId = orgs[0].id;
      const add = (values: Record<string, unknown>, on: Tx = tx) =>
        insert(on, organizationId, values);

      console.log("\nTHE TABLES");
      {
        const tables = await tx.execute<{ table_name: string }>(
          sql`select table_name from information_schema.tables
              where table_schema = 'public'
                and table_name in ('ledger_entries', 'connected_accounts',
                                   'payments', 'money_events')`
        );
        const names = new Set(tables.map((row) => row.table_name));

        check("ledger_entries exists", names.has("ledger_entries"));
        check("connected_accounts exists", names.has("connected_accounts"));
        check("payments is gone", !names.has("payments"));
        check("money_events is gone", !names.has("money_events"));
      }

      console.log("\nAPPEND-ONLY");
      let paymentId = "";
      {
        const [row] = await add({
          entry_type: "payment_received",
          amount_cents: 200_000,
          source: "stripe",
          method: "card",
          external_ref: "ch_test_1",
        });
        paymentId = row.id;

        check("a payment writes", row.amount_cents === "200000");
        check("it gets a sequence number", Number(row.seq) > 0);

        await refuses(
          "UPDATE is refused",
          tx,
          (t) =>
            t.execute(
              sql`update ledger_entries set memo = 'edited' where id = ${paymentId}`
            ),
          /append-only/i
        );

        await refuses(
          "DELETE is refused",
          tx,
          (t) =>
            t.execute(sql`delete from ledger_entries where id = ${paymentId}`),
          /append-only/i
        );
      }

      console.log("\nSIGN RULES");
      {
        await refuses(
          "a positive refund is refused",
          tx,
          (t) =>
            add(
              {
                entry_type: "refund_issued",
                amount_cents: 5_000,
                source: "stripe",
                external_ref: "re_bad",
              },
              t
            ),
          /sign_matches_type/
        );

        await refuses(
          "a negative payment is refused",
          tx,
          (t) =>
            add(
              {
                entry_type: "payment_received",
                amount_cents: -5_000,
                source: "stripe",
                external_ref: "ch_bad",
              },
              t
            ),
          /sign_matches_type/
        );

        await refuses(
          "a zero-amount row is refused",
          tx,
          (t) =>
            add(
              {
                entry_type: "payment_received",
                amount_cents: 0,
                source: "stripe",
                external_ref: "ch_zero",
              },
              t
            ),
          /amount_nonzero/
        );

        await refuses(
          "an adjustment with no memo is refused",
          tx,
          (t) =>
            add(
              {
                entry_type: "adjustment",
                amount_cents: 1_000,
                source: "manual",
              },
              t
            ),
          /adjustment_has_memo/
        );

        const [adjustment] = await add({
          entry_type: "adjustment",
          amount_cents: -1_000,
          source: "manual",
          memo: "Bank fee the shop absorbed",
        });
        check("an adjustment with a memo takes either sign", !!adjustment.id);
      }

      console.log("\nIDEMPOTENCY");
      {
        const replay = await tx.execute<{ id: string }>(
          sql`insert into ledger_entries
                (organization_id, entry_type, amount_cents, occurred_at,
                 source, external_ref)
              values (${organizationId}, 'payment_received', 200000,
                      ${OCCURRED}, 'stripe', 'ch_test_1')
              on conflict do nothing
              returning id`
        );
        check("a replayed webhook writes nothing", replay.length === 0);

        // The design brief's bug. `unique nulls not distinct` would treat these
        // two NULL external refs as equal and swallow the second cheque.
        const [first] = await add({
          entry_type: "payment_received",
          amount_cents: 40_000,
          source: "manual",
          method: "check",
        });
        const [second] = await add({
          entry_type: "payment_received",
          amount_cents: 60_000,
          source: "manual",
          method: "cash",
        });
        check(
          "two manual payments both survive",
          !!first?.id && !!second?.id && first.id !== second.id
        );
      }

      console.log("\nCORRECTIONS");
      {
        await refuses(
          "a reversal must negate exactly",
          tx,
          (t) =>
            add(
              {
                entry_type: "payment_received",
                amount_cents: -199_999,
                source: "stripe",
                reverses_id: paymentId,
              },
              t
            ),
          /does not cancel/
        );

        await refuses(
          "a reversal must keep the type",
          tx,
          (t) =>
            add(
              {
                entry_type: "refund_issued",
                amount_cents: -200_000,
                source: "stripe",
                reverses_id: paymentId,
              },
              t
            ),
          /same entry_type/
        );

        const [reversal] = await add({
          entry_type: "payment_received",
          amount_cents: -200_000,
          source: "stripe",
          reverses_id: paymentId,
          memo: "Matched to the wrong job",
        });
        check("an exact reversal writes", !!reversal.id);

        await refuses(
          "a row cannot be reversed twice",
          tx,
          (t) =>
            add(
              {
                entry_type: "payment_received",
                amount_cents: -200_000,
                source: "stripe",
                reverses_id: paymentId,
                memo: "again",
              },
              t
            ),
          /reverses_unique/
        );
      }

      console.log("\nSHOP MONEY");
      {
        const [payout] = await add({
          entry_type: "payout",
          amount_cents: -84_000,
          source: "stripe",
          external_ref: "po_test_1",
        });
        check("a payout with no job writes", !!payout.id);

        // No job exists in this transaction, so the check is proven against a
        // valid-but-absent id: the payout constraint fires before the foreign
        // key would have.
        await refuses(
          "a payout with a job is refused",
          tx,
          (t) =>
            add(
              {
                entry_type: "payout",
                amount_cents: -84_000,
                source: "stripe",
                external_ref: "po_test_2",
                job_id: "00000000-0000-0000-0000-000000000001",
              },
              t
            ),
          /payout_has_no_job/
        );
      }

      console.log("\nTHE FOLD");
      {
        const [row] = await tx.execute<{ collected: string }>(
          sql`select coalesce(sum(amount_cents), 0)::text as collected
              from ledger_entries
              where organization_id = ${organizationId}
                and entry_type in ('payment_received', 'refund_issued',
                                   'chargeback_opened', 'chargeback_reversed',
                                   'adjustment')`
        );

        // 200,000 in, 200,000 reversed away, 40,000 and 60,000 recorded by
        // hand, less a 1,000 adjustment. The 84,000 payout is not a collection
        // and must not appear.
        check(
          "collected folds to 99,000",
          row.collected === "99000",
          `got ${row.collected}`
        );
      }

      throw new Rollback();
    })
    .catch((error: unknown) => {
      if (!(error instanceof Rollback)) throw error;
    });
} finally {
  await db.$client.end({ timeout: 5 });
}

console.log(
  `\n${passed} passed, ${failures.length} failed.` +
    (failures.length ? `\n\n${failures.map((f) => `  - ${f}`).join("\n")}\n` : "\n")
);

process.exit(failures.length ? 1 : 0);
