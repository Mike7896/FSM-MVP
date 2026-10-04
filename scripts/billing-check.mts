/**
 * Progress billing, checked against a real database.
 *
 * This is the arithmetic that decides what somebody is asked to pay, so every
 * rule below is checked against real rows rather than reasoned about:
 *
 * - **The settlement reads both sides.** What is owed comes from the documents
 *   (contract plus approved change orders); what arrived comes from the ledger,
 *   so a cheque counts exactly as a card does.
 * - **Drafts and voided bills are not money anyone owes**, and must not appear
 *   in what has been billed.
 *
 * Everything runs inside a transaction that is rolled back.
 *
 *     npm run billing:check
 */

import { sql } from "drizzle-orm";

// Concrete modules rather than the barrel: this script is ESM and tsx loads the
// library as CJS, where named-export detection cannot see through `export *`.
import { jobSettlement } from "@/lib/billing/settlement";
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

class Rollback extends Error {}

// The plan's arithmetic — deposit, phases, rounding — is pure, and is checked
// without a database in `npm run plan:check`.

try {
  await db
    .transaction(async (tx) => {
      const [org] = await tx.execute<{ id: string }>(
        sql`insert into organizations (name, slug)
            values ('Billing Check', ${`billing-check-${Date.now()}`})
            returning id`
      );
      const [customer] = await tx.execute<{ id: string }>(
        sql`insert into customers (organization_id, name)
            values (${org.id}, 'Dana Whitfield') returning id`
      );
      const [job] = await tx.execute<{ id: string }>(
        sql`insert into jobs (organization_id, customer_id, name)
            values (${org.id}, ${customer.id}, 'Panel upgrade') returning id`
      );

      const newDocument = async (type: string, status: string) => {
        // Every type starts at the first status its own lifecycle allows — a
        // contract is `generated`, never `draft`, and the database says so.
        const opening = type === "contract" ? "generated" : "draft";

        const [row] = await tx.execute<{ id: string; number: string }>(
          sql`insert into documents
                (organization_id, job_id, customer_id, type, status, title)
              values (${org.id}, ${job.id}, ${customer.id},
                      ${sql.raw(`'${type}'`)}, ${sql.raw(`'${opening}'`)},
                      'Panel upgrade')
              returning id, number`
        );
        if (status !== opening) {
          await tx.execute(
            sql`update documents set status = ${sql.raw(`'${status}'`)} where id = ${row.id}`
          );
        }
        return row;
      };

      /* ── What was agreed ────────────────────────────────────────────── */

      const contract = await newDocument("contract", "generated");
      await tx.execute(
        sql`insert into contract_details (document_id, contract_sum_cents)
            values (${contract.id}, 400000)`
      );

      const approved = await newDocument("change_order", "draft");
      await tx.execute(
        sql`insert into change_order_details
              (document_id, parent_contract_id, what_changed, delta_cents)
            values (${approved.id}, ${contract.id}, 'Second circuit', 50000)`
      );
      await tx.execute(
        sql`update documents set status = 'approved' where id = ${approved.id}`
      );

      const pending = await newDocument("change_order", "sent");
      await tx.execute(
        sql`insert into change_order_details
              (document_id, parent_contract_id, what_changed, delta_cents)
            values (${pending.id}, ${contract.id}, 'Not agreed yet', 90000)`
      );

      /* ── What has been asked for ────────────────────────────────────── */

      const bill = async (
        type: string,
        cents: number,
        status: string,
        voided = false
      ) => {
        const row = await newDocument("invoice", "draft");
        await tx.execute(
          sql`insert into invoice_details (document_id, invoice_type, amount_due_cents)
              values (${row.id}, ${sql.raw(`'${type}'`)}, ${cents})`
        );
        await tx.execute(
          sql`update documents set status = ${sql.raw(`'${status}'`)} where id = ${row.id}`
        );
        if (voided) {
          await tx.execute(
            sql`update invoice_details set voided_at = now() where document_id = ${row.id}`
          );
        }
        return row;
      };

      const deposit = await bill("deposit", 100_000, "issued");
      await bill("draw", 120_000, "sent");
      await bill("draw", 50_000, "void", true);
      await bill("draw", 30_000, "draft");

      // Money in, against the deposit.
      await tx.execute(
        sql`insert into ledger_entries
              (organization_id, entry_type, amount_cents, occurred_at, source,
               job_id, invoice_id, customer_id, external_ref)
            values (${org.id}, 'payment_received', 100000, now(), 'stripe',
                    ${job.id}, ${deposit.id}, ${customer.id}, ${`ch_billing_${Date.now()}`})`
      );

      console.log("\nWHAT THE JOB SETTLES TO");

      const settlement = await jobSettlement(
        job.id,
        org.id,
        tx as unknown as typeof db
      );

      check("the job has a settlement to read", settlement !== null);
      if (settlement) {
        check(
          "agreed is the contract plus approved change orders only",
          settlement.agreedCents === 450_000 &&
            settlement.changeOrderCents === 50_000,
          `${settlement.agreedCents} / ${settlement.changeOrderCents}`
        );
        check(
          "a change order nobody approved is not owed",
          settlement.changeOrders.length === 1,
          JSON.stringify(settlement.changeOrders.map((change) => change.deltaCents))
        );
        check(
          "billed counts what went out, not drafts or withdrawals",
          settlement.billedCents === 220_000,
          String(settlement.billedCents)
        );
        check(
          "collected comes from the ledger",
          settlement.collectedCents === 100_000,
          String(settlement.collectedCents)
        );
        check(
          "what a final bill would ask for is agreed less billed",
          settlement.unbilledCents === 230_000,
          String(settlement.unbilledCents)
        );
        check(
          "what is still owed is agreed less collected",
          settlement.outstandingCents === 350_000,
          String(settlement.outstandingCents)
        );
      }

      throw new Rollback();
    })
    .catch((error) => {
      if (!(error instanceof Rollback)) throw error;
    });
} catch (error) {
  console.error("\nThe check itself failed:", error);
  process.exitCode = 1;
}

console.log(`\n${passed} passed, ${failures.length} failed`);
if (failures.length > 0) {
  for (const failure of failures) console.log(`  - ${failure}`);
  process.exitCode = 1;
}
process.exit();
