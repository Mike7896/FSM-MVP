/**
 * Progress billing, checked against a real database.
 *
 * This is the arithmetic that decides what somebody is asked to pay, so every
 * rule below is checked against real rows rather than reasoned about:
 *
 * - **The plan adds up to the agreement, exactly.** Deposit plus every stage
 *   equals the total, whatever the percentages round to — a lost cent is a job
 *   that can never be fully billed.
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
import { planFromTerms } from "@/lib/billing/schedule";
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

console.log("\nTHE PLAN THE TERMS IMPLY");
{
  const deposited = planFromTerms({
    totalCents: 1_000_000,
    depositPercent: 30,
    draws: true,
    pattern: [
      { name: "Rough-in", percent: 50 },
      { name: "Trim", percent: 30 },
      { name: "Final", percent: 20 },
    ],
  });

  check(
    "the deposit comes first, at its percentage",
    deposited[0]?.name === "Deposit" &&
      deposited[0]?.amountCents === 300_000 &&
      deposited[0]?.gate === "on_acceptance",
    JSON.stringify(deposited[0])
  );
  check(
    "the stages split what's left",
    deposited[1]?.amountCents === 350_000 && deposited[2]?.amountCents === 210_000,
    JSON.stringify(deposited.map((stage) => stage.amountCents))
  );
  check(
    "the last stage is the balance at the end",
    deposited[3]?.gate === "on_completion" && deposited[3]?.amountCents === 140_000,
    JSON.stringify(deposited[3])
  );
  check(
    "the plan adds up to the agreement",
    deposited.reduce((sum, stage) => sum + stage.amountCents, 0) === 1_000_000
  );

  const awkward = planFromTerms({
    totalCents: 100_001,
    depositPercent: 33,
    draws: true,
    pattern: [
      { name: "One", percent: 33 },
      { name: "Two", percent: 33 },
      { name: "Three", percent: 34 },
    ],
  });
  check(
    "it still adds up when the percentages don't divide",
    awkward.reduce((sum, stage) => sum + stage.amountCents, 0) === 100_001,
    JSON.stringify(awkward.map((stage) => stage.amountCents))
  );

  const once = planFromTerms({
    totalCents: 250_000,
    depositPercent: null,
    draws: false,
    pattern: null,
  });
  check(
    "no deposit and no stages is one bill at the end",
    once.length === 1 &&
      once[0].gate === "on_completion" &&
      once[0].amountCents === 250_000,
    JSON.stringify(once)
  );

  const depositOnly = planFromTerms({
    totalCents: 200_000,
    depositPercent: 25,
    draws: false,
    pattern: null,
  });
  check(
    "a deposit with no stages leaves the balance at the end",
    depositOnly.length === 2 &&
      depositOnly[0].amountCents === 50_000 &&
      depositOnly[1].amountCents === 150_000,
    JSON.stringify(depositOnly)
  );
}

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
