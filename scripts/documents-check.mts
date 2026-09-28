/**
 * The document spine, checked against a real database.
 *
 * The freeze is the whole point of this schema, and a freeze that the
 * application merely *observes* is not one — so every rule below is proven
 * against the role product code actually connects as, which bypasses RLS:
 *
 * - **A document freezes itself.** Nothing calls "freeze"; moving the status
 *   into the type's frozen set stamps `frozen_at`, so no code path can forget.
 * - **Frozen means frozen, except for what happened next.** Scope, sum and
 *   header are settled forever; `status`, `voided_at` and `gate_met_at` still
 *   move, because an invoice has to reach `paid` and `void` after it is frozen
 *   and the design doc's trigger made both impossible.
 * - **Allowance settlement writes onto a frozen contract.** §4 puts the settled
 *   amount on the allowance node itself, and that node belongs to a signed
 *   contract — so this is the one scope write that must survive the freeze.
 * - **The second signature freezes the contract**, from a trigger on a
 *   different table.
 * - **A change order amends a contract**, never a quote.
 *
 *     npm run documents:check
 */

import { sql } from "drizzle-orm";
import type { PgTransaction } from "drizzle-orm/pg-core";

import { db } from "@/lib/db";
// Imported from the concrete modules rather than the barrel. This script is
// ESM (`.mts`) and tsx loads the library as CJS, where named-export detection
// cannot see through `export * from`. Application code goes through the
// barrel normally — this is a limitation of the script runner, not the module.
import { buildScopeTree } from "@/lib/documents/types";
import { canEdit, loadDocument } from "@/lib/documents/repository";
import { currentAgreedScope } from "@/lib/documents/operations/agreed-scope";
import { acceptQuote } from "@/lib/documents/operations/accept-quote";
import { scopeTotals } from "@/lib/documents/scope";

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

/** Runs a statement in a savepoint and reports whether the database refused it. */
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
    const message = error instanceof Error ? error.message : String(error);
    const cause = (error as { cause?: unknown }).cause;
    const text = cause instanceof Error ? `${message} ${cause.message}` : message;
    check(label, expect ? expect.test(text) : true, expect ? text : undefined);
  }
}

class Rollback extends Error {}

try {
  await db
    .transaction(async (tx) => {
      /* ── Fixtures ──────────────────────────────────────────────────── */

      const [org] = await tx.execute<{ id: string }>(
        sql`insert into organizations (name, slug)
            values ('Documents Check', ${`documents-check-${Date.now()}`})
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

      const newDocument = (
        type: string,
        status: string,
        on: Tx = tx,
        title = "Untitled"
      ) =>
        on.execute<{ id: string; number: string; frozen_at: string | null }>(
          sql`insert into documents
                (organization_id, job_id, customer_id, type, status, title)
              values (${org.id}, ${job.id}, ${customer.id},
                      ${sql.raw(`'${type}'`)}, ${sql.raw(`'${status}'`)}, ${title})
              returning id, number, frozen_at`
        );

      const addNode = (
        documentId: string,
        values: Record<string, unknown>,
        on: Tx = tx
      ) => {
        const row: Record<string, unknown> = {
          organization_id: org.id,
          document_id: documentId,
          description: "Service panel, 200A",
          ...values,
        };
        const keys = Object.keys(row);
        const bound = sql.join(
          keys.map((key) => sql`${row[key]}`),
          sql`, `
        );
        return on.execute<{ id: string }>(
          sql`insert into scope_nodes (${sql.raw(keys.join(", "))})
              values (${bound}) returning id`
        );
      };

      console.log("\nNUMBERING");
      {
        const [first] = await newDocument("quote", "draft");
        const [second] = await newDocument("quote", "draft");
        const [invoice] = await newDocument("invoice", "draft");

        check("the first quote is Q-0001", first.number === "Q-0001", first.number);
        check("the second is Q-0002", second.number === "Q-0002", second.number);
        check(
          "invoices count independently",
          invoice.number === "INV-0001",
          invoice.number
        );

        await tx.execute(sql`insert into invoice_details
            (document_id, invoice_type, amount_due_cents)
          values (${invoice.id}, 'deposit', 250000)`);
      }

      console.log("\nCLOSED STATUS SETS");
      {
        await refuses(
          "an invoice cannot be part_signed",
          tx,
          (t) => newDocument("invoice", "part_signed", t),
          /status_matches_type/
        );

        await refuses(
          "a quote cannot be issued",
          tx,
          (t) => newDocument("quote", "issued", t),
          /status_matches_type/
        );
      }

      console.log("\nTHE FREEZE STAMPS ITSELF");
      let acceptedQuote = "";
      {
        const [quote] = await newDocument("quote", "draft", tx, "Panel upgrade");
        acceptedQuote = quote.id;
        check("a draft quote is not frozen", quote.frozen_at === null);

        const [sent] = await tx.execute<{ frozen_at: string | null }>(
          sql`update documents set status = 'sent' where id = ${quote.id}
              returning frozen_at`
        );
        check("sending does not freeze it", sent.frozen_at === null);

        const [accepted] = await tx.execute<{ frozen_at: string | null }>(
          sql`update documents set status = 'accepted' where id = ${quote.id}
              returning frozen_at`
        );
        check(
          "accepting freezes it, with nothing asking",
          accepted.frozen_at !== null
        );
      }

      console.log("\nFROZEN MEANS FROZEN");
      {
        await refuses(
          "the title cannot be edited",
          tx,
          (t) =>
            t.execute(
              sql`update documents set title = 'Rewrite' where id = ${acceptedQuote}`
            ),
          /is frozen/
        );

        await refuses(
          "the header snapshot cannot be rewritten",
          tx,
          (t) =>
            t.execute(
              sql`update documents set header_snapshot = '{"businessName":"Someone else"}'::jsonb
                  where id = ${acceptedQuote}`
            ),
          /is frozen/
        );

        await refuses(
          "it cannot be deleted",
          tx,
          (t) => t.execute(sql`delete from documents where id = ${acceptedQuote}`),
          /cannot be deleted/
        );

        // What happened *next* still moves. She can still open a quote she
        // already accepted, and the product still wants to know she did.
        const [viewed] = await tx.execute<{ viewed_at: string | null }>(
          sql`update documents set viewed_at = now() where id = ${acceptedQuote}
              returning viewed_at`
        );
        check("but she can still open it", viewed.viewed_at !== null);
      }

      console.log("\nAN INVOICE AFTER ISSUE");
      {
        const [invoice] = await newDocument("invoice", "draft");
        await tx.execute(sql`insert into invoice_details
            (document_id, invoice_type, amount_due_cents)
          values (${invoice.id}, 'draw', 400000)`);

        const [issued] = await tx.execute<{ frozen_at: string | null }>(
          sql`update documents set status = 'issued' where id = ${invoice.id}
              returning frozen_at`
        );
        check("issuing freezes it", issued.frozen_at !== null);

        await refuses(
          "the amount cannot be edited",
          tx,
          (t) =>
            t.execute(
              sql`update invoice_details set amount_due_cents = 1
                  where document_id = ${invoice.id}`
            ),
          /is frozen/
        );

        // The two the design doc's trigger made impossible.
        const [voided] = await tx.execute<{ voided_at: string | null }>(
          sql`update invoice_details set voided_at = now()
              where document_id = ${invoice.id} returning voided_at`
        );
        check("but it can still be voided", voided.voided_at !== null);

        const [status] = await tx.execute<{ status: string }>(
          sql`update documents set status = 'void' where id = ${invoice.id}
              returning status`
        );
        check("and the status follows", status.status === "void");

        const [gate] = await tx.execute<{ gate_met_at: string | null }>(
          sql`update invoice_details set gate_met_at = now()
              where document_id = ${invoice.id} returning gate_met_at`
        );
        check("the gate can still be met", gate.gate_met_at !== null);
      }

      console.log("\nSCOPE FREEZES WITH ITS DOCUMENT");
      {
        const [contract] = await newDocument("contract", "generated");
        await tx.execute(sql`insert into contract_details
            (document_id, contract_sum_cents) values (${contract.id}, 1000000)`);

        const [allowance] = await addNode(contract.id, {
          node_type: "allowance",
          section: "material",
          description: "Fixture allowance",
          sell_price_cents: 220000,
          position: 0,
        });
        const [item] = await addNode(contract.id, {
          node_type: "item",
          section: "labor",
          sell_price_cents: 780000,
          position: 1,
        });
        check("scope writes while the contract is open", !!allowance.id && !!item.id);

        await refuses(
          "a group cannot carry a cost bucket",
          tx,
          (t) =>
            addNode(
              contract.id,
              { node_type: "group", section: "material", position: 9 },
              t
            ),
          /bucket_matches_type/
        );

        // Two signatures: the contractor's at generation, hers on acceptance.
        await tx.execute(sql`insert into document_signatures
            (document_id, party, printed_name, signature_data)
          values (${contract.id}, 'contractor', 'Ray Mercer', 'typed:Ray Mercer')`);

        const [partial] = await tx.execute<{ status: string; frozen_at: string | null }>(
          sql`select status, frozen_at from documents where id = ${contract.id}`
        );
        check("one signature is part_signed", partial.status === "part_signed");
        check("...and not yet frozen", partial.frozen_at === null);

        await tx.execute(sql`insert into document_signatures
            (document_id, party, printed_name, signature_data)
          values (${contract.id}, 'customer', 'Dana Whitfield', 'typed:Dana Whitfield')`);

        const [signed] = await tx.execute<{ status: string; frozen_at: string | null }>(
          sql`select status, frozen_at from documents where id = ${contract.id}`
        );
        check("the second signature signs it", signed.status === "signed");
        check("...and freezes it", signed.frozen_at !== null);

        await refuses(
          "nothing can be added to frozen scope",
          tx,
          (t) =>
            addNode(
              contract.id,
              { node_type: "item", section: "material", position: 5 },
              t
            ),
          /added work is a change order/i
        );

        await refuses(
          "nothing can be removed from it",
          tx,
          (t) => t.execute(sql`delete from scope_nodes where id = ${item.id}`),
          /deduct change order/i
        );

        await refuses(
          "a price cannot be edited",
          tx,
          (t) =>
            t.execute(
              sql`update scope_nodes set sell_price_cents = 1 where id = ${item.id}`
            ),
          /is frozen/
        );

        // The one write that must survive the freeze: §4's allowance
        // settlement lands on the allowance node, which lives on this
        // now-frozen contract.
        const [settled] = await tx.execute<{ allowance_settled_cents: string | null }>(
          sql`update scope_nodes
                 set allowance_settled_cents = 241800,
                     allowance_settled_at = now()
               where id = ${allowance.id}
              returning allowance_settled_cents`
        );
        check(
          "but an allowance can still settle",
          settled.allowance_settled_cents === "241800",
          `got ${settled.allowance_settled_cents}`
        );

        await refuses(
          "a signature is never revised",
          tx,
          (t) =>
            t.execute(
              sql`update document_signatures set printed_name = 'Someone else'
                  where document_id = ${contract.id} and party = 'customer'`
            ),
          /audit record/
        );

        console.log("\nA CHANGE ORDER AMENDS A CONTRACT");
        {
          const [changeOrder] = await newDocument("change_order", "draft");
          await tx.execute(sql`insert into change_order_details
              (document_id, parent_contract_id, delta_cents, what_changed)
            values (${changeOrder.id}, ${contract.id}, 185000, 'Added two circuits')`);

          const [node] = await addNode(changeOrder.id, {
            node_type: "item",
            section: "material",
            description: "Recessed cans, 6",
            sell_price_cents: 185000,
            position: 0,
            references_node_id: allowance.id,
            reference_kind: "settles",
          });
          check("it can reference a contracted node", !!node.id);

          await refuses(
            "a reference needs a kind",
            tx,
            (t) =>
              addNode(
                changeOrder.id,
                {
                  node_type: "item",
                  section: "material",
                  position: 8,
                  references_node_id: allowance.id,
                },
                t
              ),
            /reference_is_complete/
          );

          const [quoteDoc] = await newDocument("quote", "draft");
          await refuses(
            "it cannot amend a quote",
            tx,
            (t) =>
              t.execute(sql`insert into change_order_details
                  (document_id, parent_contract_id, delta_cents)
                values (${changeOrder.id}, ${quoteDoc.id}, 1000)`),
            /amends a contract/
          );
        }
      }

      console.log("");
      console.log("ACCEPT QUOTE (operation 1)");
      {
        // A shop that signs its own contracts automatically.
        await tx.execute(
          sql`insert into office_defaults
                (organization_id, signature_name, signature_mark)
              values (${org.id}, 'Ray Mercer', 'typed:Ray Mercer')`
        );

        const [quote] = await newDocument("quote", "sent", tx, "Panel upgrade");
        await tx.execute(sql`insert into quote_details
            (document_id, deposit_percent, contract_type, tax_rate)
          values (${quote.id}, 30, 'lump_sum', 0.0825)`);

        // A group with a child, so the parent rewrite is actually exercised.
        const [group] = await addNode(quote.id, {
          node_type: "group",
          description: "Service",
          position: 0,
        });
        await addNode(quote.id, {
          node_type: "item",
          section: "material",
          description: "Service panel, 200A",
          sell_price_cents: 300000,
          parent_node_id: group.id,
          position: 1,
        });
        await addNode(quote.id, {
          node_type: "item",
          section: "labor",
          description: "Install",
          sell_price_cents: 200000,
          position: 2,
        });
        // Optional rows are not in the price she agrees to.
        await addNode(quote.id, {
          node_type: "item",
          section: "material",
          description: "Surge protector",
          sell_price_cents: 40000,
          optional: true,
          position: 3,
        });

        const contract = await acceptQuote(quote.id, org.id, { on: tx });

        check("it produces a contract", contract.type === "contract");
        // Its own sequence, not the quote's — an earlier block in this
        // transaction already took C-0001, which is the behaviour, not a bug.
        check(
          "numbered on the contract sequence",
          contract.number.startsWith("C-") && contract.number !== quote.number,
          contract.number
        );
        check("sourced from the quote", contract.sourceDocumentId === quote.id);

        // 300,000 + 200,000 priced, optional excluded; tax on material only.
        const expected = scopeTotals(
          contract.scope,
          "0.0825"
        ).totalCents;
        check(
          "the contract sum is the quote's own arithmetic",
          contract.details?.contractSumCents === expected,
          `${contract.details?.contractSumCents} vs ${expected}`
        );
        check(
          "the deposit follows the quote's percentage",
          contract.details?.depositPercent === 30 &&
            contract.details?.depositBasis === "percent"
        );

        check("the scope is copied, not shared", contract.scope.length === 4);
        check(
          "every copied node knows its origin",
          contract.scope.every((n) => n.copiedFromNodeId !== null)
        );

        const copiedGroup = contract.scope.find((n) => n.nodeType === "group");
        const child = contract.scope.find((n) => n.parentNodeId !== null);
        check(
          "parent links are rewritten to the new ids",
          !!copiedGroup && child?.parentNodeId === copiedGroup.id
        );
        check(
          "...and point at the contract's nodes, not the quote's",
          child?.parentNodeId !== group.id
        );

        check(
          "the contractor's signature is applied",
          contract.signatures.length === 1 &&
            contract.signatures[0].party === "contractor"
        );
        check(
          "one signature is not yet an agreement",
          contract.status === "part_signed" && contract.frozenAt === null
        );

        const [frozenQuote] = await tx.execute<{ status: string; frozen_at: string | null }>(
          sql`select status, frozen_at from documents where id = ${quote.id}`
        );
        check("the quote is accepted", frozenQuote.status === "accepted");
        check("...and frozen", frozenQuote.frozen_at !== null);

        await refuses(
          "it cannot be accepted twice",
          tx,
          () => acceptQuote(quote.id, org.id, { on: tx }),
          /already been accepted/
        );
      }

      console.log("\nTHE FOLD (operation 7 - writes nothing)");
      {
        // Hand-built rather than loaded: `currentAgreedScope` is pure, and the
        // point of it being pure is that this arithmetic is testable without a
        // database at all.
        const node = (over: Record<string, unknown>) =>
          ({
            id: "n0",
            organizationId: org.id,
            documentId: "d0",
            parentNodeId: null,
            position: 0,
            nodeType: "item",
            section: "material",
            optional: false,
            description: "row",
            quantity: "1",
            unit: null,
            unitCostCents: null,
            markupBps: null,
            sellPriceCents: 0,
            taxable: true,
            details: {},
            source: "typed",
            copiedFromNodeId: null,
            referencesNodeId: null,
            referenceKind: null,
            allowanceSettledCents: null,
            allowanceSettledAt: null,
            createdAt: new Date(),
            ...over,
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
          }) as any;

        const contract = {
          id: "c1",
          type: "contract",
          number: "C-0001",
          status: "signed",
          details: { contractSumCents: 1_000_000 },
          scope: [
            node({ id: "a", position: 0, sellPriceCents: 300_000, description: "Panel" }),
            node({ id: "b", position: 1, sellPriceCents: 220_000, nodeType: "allowance", description: "Fixtures" }),
            node({ id: "c", position: 2, sellPriceCents: 480_000, description: "Rough-in" }),
          ],
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
        } as any;

        const changeOrders = [
          {
            id: "co1",
            type: "change_order",
            number: "CO-0001",
            status: "approved",
            details: { deltaCents: 185_000, approvedAt: new Date("2026-08-01") },
            scope: [
              // Replaces the panel, settles the allowance, adds a row.
              node({ id: "a2", documentId: "co1", position: 0, sellPriceCents: 340_000,
                     description: "Panel, 200A", referencesNodeId: "a", referenceKind: "supersedes" }),
              node({ id: "s1", documentId: "co1", position: 1, sellPriceCents: 241_800,
                     referencesNodeId: "b", referenceKind: "settles" }),
              node({ id: "n1", documentId: "co1", position: 2, sellPriceCents: 145_000,
                     description: "Two circuits" }),
            ],
          },
          {
            id: "co2",
            type: "change_order",
            number: "CO-0002",
            status: "draft",
            details: { deltaCents: 999_999, approvedAt: null },
            scope: [node({ id: "x", documentId: "co2", sellPriceCents: 999_999 })],
          },
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
        ] as any;

        const agreed = currentAgreedScope(contract, changeOrders);

        check("a draft change order is not agreed to", agreed.applied.length === 1);
        check(
          "net change is the approved delta only",
          agreed.netChangeCents === 185_000,
          String(agreed.netChangeCents)
        );
        check(
          "contract sum to date adds up",
          agreed.contractSumToDateCents === 1_185_000,
          String(agreed.contractSumToDateCents)
        );

        const ids = agreed.nodes.map((n) => n.id);
        check("the superseded row is gone", !ids.includes("a"));
        check("its replacement took its place", ids[0] === "a2", ids.join(","));
        check("the allowance survives settlement", ids.includes("b"));
        check("the settlement did not add a row", !ids.includes("s1"));
        check(
          "the allowance carries its settled amount",
          agreed.nodes.find((n) => n.id === "b")?.settledCents === 241_800
        );
        check("added work is appended", ids.includes("n1"));
        check(
          "added work knows which change order it came from",
          agreed.nodes.find((n) => n.id === "n1")?.origin.number === "CO-0001"
        );
      }

      throw new Rollback();
    })
    .catch((error: unknown) => {
      if (!(error instanceof Rollback)) throw error;
    });

  /* ── The loader ─────────────────────────────────────────────────────── */

  // Outside the rolled-back transaction, because `loadDocument` uses the
  // module-level connection and would not see uncommitted rows. Cleaned up by
  // deleting the organization, which cascades — and which only works because
  // every document here is left unfrozen.
  console.log("\nTHE LOADER");
  let scratchOrg = "";
  try {
    const [org] = await db.execute<{ id: string }>(
      sql`insert into organizations (name, slug)
          values ('Loader Check', ${`loader-check-${Date.now()}`}) returning id`
    );
    scratchOrg = org.id;

    const [customer] = await db.execute<{ id: string }>(
      sql`insert into customers (organization_id, name)
          values (${org.id}, 'Dana Whitfield') returning id`
    );
    const [job] = await db.execute<{ id: string }>(
      sql`insert into jobs (organization_id, customer_id, name)
          values (${org.id}, ${customer.id}, 'Panel upgrade') returning id`
    );
    const [doc] = await db.execute<{ id: string }>(
      sql`insert into documents
            (organization_id, job_id, customer_id, type, status, title,
             header_snapshot)
          values (${org.id}, ${job.id}, ${customer.id}, 'quote', 'draft',
                  'Panel upgrade', '{"businessName":"Mercer Electric"}'::jsonb)
          returning id`
    );
    await db.execute(sql`insert into quote_details (document_id, contract_type, deposit_percent)
        values (${doc.id}, 'lump_sum', 30)`);

    const [group] = await db.execute<{ id: string }>(
      sql`insert into scope_nodes
            (organization_id, document_id, node_type, description, position)
          values (${org.id}, ${doc.id}, 'group', 'Service', 0) returning id`
    );
    await db.execute(
      sql`insert into scope_nodes
            (organization_id, document_id, parent_node_id, node_type, section,
             description, sell_price_cents, position)
          values (${org.id}, ${doc.id}, ${group.id}, 'item', 'material',
                  'Service panel, 200A', 180000, 1)`
    );

    const loaded = await loadDocument(doc.id, org.id);

    check("it loads", loaded !== null);
    check("with the right type", loaded?.type === "quote");
    check(
      "the side table is composed in",
      loaded?.type === "quote" && loaded.details?.depositPercent === 30
    );
    check("the header snapshot survives", loaded?.header.businessName === "Mercer Electric");
    check("scope comes with it", loaded?.scope.length === 2);
    check("a draft is editable", loaded !== null && canEdit(loaded));

    const tree = buildScopeTree(loaded?.scope ?? []);
    check("the flat array builds a tree", tree.length === 1 && tree[0].children.length === 1);

    // Wrong shop, right id. The scoping is the authorization.
    const [other] = await db.execute<{ id: string }>(
      sql`insert into organizations (name, slug)
          values ('Somebody Else', ${`other-${Date.now()}`}) returning id`
    );
    check(
      "another shop cannot load it",
      (await loadDocument(doc.id, other.id)) === null
    );
    await db.execute(sql`delete from organizations where id = ${other.id}`);
  } finally {
    if (scratchOrg) {
      await db.execute(sql`delete from organizations where id = ${scratchOrg}`);
    }
  }
} finally {
  await db.$client.end({ timeout: 5 });
}

console.log(
  `\n${passed} passed, ${failures.length} failed.` +
    (failures.length ? `\n\n${failures.map((f) => `  - ${f}`).join("\n")}\n` : "\n")
);

process.exit(failures.length ? 1 : 0);
