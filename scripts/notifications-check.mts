/**
 * Notifications, checked against a real database.
 *
 * What goes wrong with a notification is rarely a crash. It is a sentence that
 * is false by the time it is read, or one that arrives twice. So everything
 * here runs against real rows, inside a transaction that is rolled back:
 *
 * - **Every event re-reads its state.** A quote nobody opened wasn't opened;
 *   one that wasn't accepted wasn't approved; a paid invoice isn't overdue; a
 *   demo is nobody's news.
 * - **The words follow Content Design §7.6** — the customer and the amount in
 *   the title, a different fact in the body, and a link to the screen that
 *   changes the state.
 * - **A repeat is a no-op**, enforced by the database rather than the caller.
 *
 *     npm run notifications:check
 */

import { randomUUID } from "node:crypto";

import { sql } from "drizzle-orm";

import { db } from "@/lib/db";
// Concrete modules rather than barrels — see the note in documents-check.
import { acceptQuote } from "@/lib/documents/operations/accept-quote";
import { compose, type NotificationEvent } from "@/lib/notifications/compose";

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

/** A calendar date this many days from today, as the database stores one. */
function day(offset: number) {
  return new Date(Date.now() + offset * 86_400_000).toISOString().slice(0, 10);
}

try {
  await db
    .transaction(async (tx) => {
      const say = (event: NotificationEvent) =>
        compose(event, tx as unknown as typeof db);

      /* ── Fixtures ──────────────────────────────────────────────────── */

      const [org] = await tx.execute<{ id: string }>(
        sql`insert into organizations (name, slug)
            values ('Notifications Check', ${`notifications-check-${Date.now()}`})
            returning id`
      );
      const organizationId = org.id;

      const [customer] = await tx.execute<{ id: string }>(
        sql`insert into customers (organization_id, name)
            values (${org.id}, 'Dana Whitfield') returning id`
      );
      const [job] = await tx.execute<{ id: string }>(
        sql`insert into jobs (organization_id, customer_id, name)
            values (${org.id}, ${customer.id}, 'Panel upgrade') returning id`
      );
      const [demoCustomer] = await tx.execute<{ id: string }>(
        sql`insert into customers (organization_id, name, is_demo)
            values (${org.id}, 'Dana Whitfield', true) returning id`
      );
      const [demoJob] = await tx.execute<{ id: string }>(
        sql`insert into jobs (organization_id, customer_id, name, is_demo)
            values (${org.id}, ${demoCustomer.id}, 'Panel upgrade', true)
            returning id`
      );

      /** A document, walked to `status` by update so the freeze stamps itself. */
      async function newDocument(
        type: "quote" | "invoice",
        status: string,
        options: { title?: string | null; jobId?: string; customerId?: string } = {}
      ) {
        const [row] = await tx.execute<{ id: string; number: string }>(
          sql`insert into documents
                (organization_id, job_id, customer_id, type, status, title)
              values (${org.id}, ${options.jobId ?? job.id},
                      ${options.customerId ?? customer.id},
                      ${sql.raw(`'${type}'`)}, 'draft',
                      ${options.title === undefined ? "Panel upgrade" : options.title})
              returning id, number`
        );
        if (status !== "draft") {
          await tx.execute(
            sql`update documents
                   set status = ${sql.raw(`'${status}'`)},
                       sent_at = now() - interval '2 days',
                       viewed_at = ${status === "viewed" ? sql`now()` : sql`null`}
                 where id = ${row.id}`
          );
        }
        return row;
      }

      async function priced(documentId: string, cents: number) {
        await tx.execute(
          sql`insert into scope_nodes
                (organization_id, document_id, node_type, section, description,
                 quantity, sell_price_cents)
              values (${org.id}, ${documentId}, 'item', 'material',
                      'Service panel, 200A', 1, ${cents})`
        );
      }

      async function invoice(type: string, cents: number, dueOn: string) {
        const row = await newDocument("invoice", "draft");
        // Details go on while it is a draft — issuing freezes them.
        await tx.execute(
          sql`insert into invoice_details
                (document_id, invoice_type, amount_due_cents, due_on)
              values (${row.id}, ${sql.raw(`'${type}'`)}, ${cents}, ${dueOn})`
        );
        return row;
      }

      async function issue(documentId: string) {
        await tx.execute(
          sql`update documents set status = 'issued' where id = ${documentId}`
        );
      }

      async function payment(
        cents: number,
        ref: string,
        invoiceId: string | null
      ) {
        const [row] = await tx.execute<{ id: string }>(
          sql`insert into ledger_entries
                (organization_id, entry_type, amount_cents, occurred_at, source,
                 job_id, invoice_id, customer_id, external_ref)
              values (${org.id}, 'payment_received', ${cents}, now(), 'stripe',
                      ${job.id}, ${invoiceId}, ${customer.id}, ${ref})
              returning id`
        );
        return row.id;
      }

      console.log("\nA QUOTE IS OPENED");
      {
        const quote = await newDocument("quote", "viewed");
        await priced(quote.id, 180000);

        const said = await say({
          kind: "quote.viewed",
          organizationId,
          documentId: quote.id,
        });
        check(
          "names the customer and the quote",
          said?.title === "Dana Whitfield opened the panel upgrade quote",
          said?.title
        );
        check(
          "the body adds the number and the amount instead of repeating the title",
          said?.body.startsWith(`${quote.number} · $1,800 · sent `) === true,
          said?.body
        );
        check("links to the quote", said?.href === `/quotes/${quote.id}`, said?.href);
        check(
          "is keyed to the quote",
          said?.dedupeKey === `quote.viewed:${quote.id}`,
          said?.dedupeKey
        );

        const unopened = await newDocument("quote", "sent");
        check(
          "a quote nobody opened says nothing",
          (await say({
            kind: "quote.viewed",
            organizationId,
            documentId: unopened.id,
          })) === null
        );

        const untitled = await newDocument("quote", "viewed", { title: null });
        const bare = await say({
          kind: "quote.viewed",
          organizationId,
          documentId: untitled.id,
        });
        check(
          "an untitled quote is named by its number, once",
          bare?.title === `Dana Whitfield opened ${untitled.number}` &&
            !bare.body.includes(untitled.number),
          `${bare?.title} / ${bare?.body}`
        );

        const demo = await newDocument("quote", "viewed", {
          jobId: demoJob.id,
          customerId: demoCustomer.id,
        });
        check(
          "a demo is nobody's news",
          (await say({
            kind: "quote.viewed",
            organizationId,
            documentId: demo.id,
          })) === null
        );

        check(
          "another Office's id finds nothing",
          (await say({
            kind: "quote.viewed",
            organizationId: randomUUID(),
            documentId: quote.id,
          })) === null
        );
      }

      console.log("\nA QUOTE IS APPROVED");
      {
        const quote = await newDocument("quote", "viewed");
        await priced(quote.id, 400000);
        await tx.execute(
          sql`insert into quote_details (document_id, deposit_percent)
              values (${quote.id}, 25)`
        );

        const event = {
          kind: "quote.accepted" as const,
          organizationId,
          documentId: quote.id,
        };
        check("before acceptance there is nothing to say", (await say(event)) === null);

        await acceptQuote(quote.id, organizationId, { on: tx });

        const said = await say(event);
        check(
          "names the deposit that is now due",
          said?.title ===
            "Dana Whitfield approved the panel upgrade quote — $1,000 deposit is due",
          said?.title
        );
        check(
          "the body is the contract, not the title again",
          said?.body === `${quote.number} is a $4,000 contract now, ready for signatures.`,
          said?.body
        );
        check(
          "links to the contract",
          said?.href === `/jobs/${job.id}/contract`,
          said?.href
        );
      }

      console.log("\nMONEY CLEARS");
      {
        const deposit = await invoice("deposit", 25000, day(14));
        await issue(deposit.id);

        const part = await say({
          kind: "payment.received",
          organizationId,
          ledgerEntryId: await payment(10000, "ch_check_part", deposit.id),
        });
        check(
          "a part payment says what it went toward",
          part?.title === "Dana Whitfield paid $100 toward the deposit",
          part?.title
        );
        check(
          "…and what is still owing",
          part?.body ===
            `${deposit.number} on the panel upgrade job still has $150 owing.`,
          part?.body
        );
        check("links to the job", part?.href === `/jobs/${job.id}`, part?.href);

        const rest = await say({
          kind: "payment.received",
          organizationId,
          ledgerEntryId: await payment(15000, "ch_check_rest", deposit.id),
        });
        check(
          "the payment that finishes it says so",
          rest?.body === `That settles ${deposit.number} on the panel upgrade job.`,
          rest?.body
        );

        const loose = await say({
          kind: "payment.received",
          organizationId,
          ledgerEntryId: await payment(5000, "ch_check_loose", null),
        });
        check(
          "money on a job with no invoice is still news",
          loose?.title === "Dana Whitfield paid $50" &&
            loose.body === "It's on the panel upgrade job, not against an invoice yet.",
          `${loose?.title} / ${loose?.body}`
        );
      }

      console.log("\nAN INVOICE GOES OVERDUE");
      {
        const late = await invoice("draw", 120000, day(-3));
        const event = {
          kind: "invoice.overdue" as const,
          organizationId,
          documentId: late.id,
        };
        check("a draft is owed by nobody", (await say(event)) === null);

        await issue(late.id);
        const said = await say(event);
        check(
          "names the customer, how late, and how much",
          said?.title === "Dana Whitfield is 3 days late on $1,200",
          said?.title
        );
        check(
          "the body is the due date",
          said?.body.startsWith(`${late.number} was due `) === true,
          said?.body
        );
        check("links to the invoice", said?.href === `/invoices/${late.id}`, said?.href);

        const notYet = await invoice("draw", 50000, day(5));
        await issue(notYet.id);
        check(
          "an invoice not yet due says nothing",
          (await say({
            kind: "invoice.overdue",
            organizationId,
            documentId: notYet.id,
          })) === null
        );

        await payment(120000, "ch_check_overdue", late.id);
        check("once it's paid, it isn't overdue", (await say(event)) === null);
      }

      console.log("\nA LICENSE COMES UP FOR RENEWAL");
      {
        async function license(expiresOn: string) {
          const [row] = await tx.execute<{ id: string }>(
            sql`insert into licenses (organization_id, jurisdiction, number, expires_on)
                values (${org.id}, 'Texas', 'EC-7001', ${expiresOn}) returning id`
          );
          return {
            kind: "license.renewal" as const,
            organizationId,
            licenseId: row.id,
          };
        }

        const soon = await say(await license(day(20)));
        check(
          "counts down inside the reminder window",
          soon?.title === "Your Texas license expires in 20 days",
          soon?.title
        );
        check(
          "is keyed to the license and its date, so a renewal re-arms it",
          soon?.dedupeKey.endsWith(`:${day(20)}`) === true,
          soon?.dedupeKey
        );
        check("links to licenses", soon?.href === "/office/licenses", soon?.href);

        check(
          "outside the window there is nothing yet",
          (await say(await license(day(90)))) === null
        );

        const lapsed = await say(await license(day(-10)));
        check(
          "a lapsed license says so",
          lapsed?.title === "Your Texas license expired 10 days ago",
          lapsed?.title
        );

        check(
          "long expired is a record, not news",
          (await say(await license(day(-45)))) === null
        );
      }

      console.log("\nAN INSPECTION RESULT");
      {
        const [permit] = await tx.execute<{ id: string }>(
          sql`insert into permits (job_id, jurisdiction)
              values (${job.id}, 'Philadelphia') returning id`
        );
        const inspect = async (result: string, corrections: string | null = null) => {
          const [row] = await tx.execute<{ id: string }>(
            sql`insert into inspections (permit_id, job_id, type, result, corrections_required)
                values (${permit.id}, ${job.id}, 'rough_in', ${result}, ${corrections})
                returning id`
          );
          return say({ kind: "inspection.result", organizationId, inspectionId: row.id });
        };

        check("a scheduled inspection is nobody's news", (await inspect("scheduled")) === null);

        const failed = await inspect("failed", "Box fill over code at the kitchen island.");
        check(
          "a fail names the inspection and the job",
          failed?.title === "The rough-in inspection on the panel upgrade job failed",
          failed?.title
        );
        check(
          "…and the body says what has to be corrected",
          failed?.body.startsWith("Corrections required: Box fill") === true,
          failed?.body
        );
        check(
          "…and opens the permit",
          failed?.href === `/jobs/${job.id}/permits/${permit.id}`,
          failed?.href
        );

        const passedOne = await inspect("passed");
        check(
          "a pass says so",
          passedOne?.title === "The rough-in inspection on the panel upgrade job passed",
          passedOne?.title
        );
        check(
          "a fail and a later pass are two pieces of news",
          Boolean(failed && passedOne && failed.dedupeKey !== passedOne.dedupeKey)
        );

        const [demoPermit] = await tx.execute<{ id: string }>(
          sql`insert into permits (job_id, jurisdiction)
              values (${demoJob.id}, 'Philadelphia') returning id`
        );
        const [demoInspection] = await tx.execute<{ id: string }>(
          sql`insert into inspections (permit_id, job_id, type, result)
              values (${demoPermit.id}, ${demoJob.id}, 'final', 'passed') returning id`
        );
        check(
          "a demo's inspection tells nobody",
          (await say({
            kind: "inspection.result",
            organizationId,
            inspectionId: demoInspection.id,
          })) === null
        );
      }

      console.log("\nTELLING SOMEONE TWICE");
      {
        const [person] = await tx.execute<{ id: string }>(
          sql`select id from auth.users limit 1`
        );

        if (!person) {
          console.log("  skip no account exists to address one to");
        } else {
          const write = () =>
            tx.execute<{ id: string }>(
              sql`insert into notifications
                    (organization_id, user_id, kind, title, body, href, dedupe_key)
                  values (${org.id}, ${person.id}, 'quote.viewed',
                          'Dana Whitfield opened the panel upgrade quote',
                          '$1,800', '/quotes', 'quote.viewed:check')
                  on conflict (user_id, dedupe_key) do nothing
                  returning id`
            );

          check("the first write lands", (await write()).length === 1);
          check("the same event again writes nothing", (await write()).length === 0);
        }
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
