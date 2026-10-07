/**
 * Signing a quote to accept it, checked against a real database.
 *
 * Quote Document Structure §3.5: when a quote carries signature lines, the
 * customer accepts by signing it, and the contract it generates arrives signed
 * by both. What has to hold:
 *
 * - **It is one act.** A refused signature leaves the quote unaccepted — never
 *   a contract she approved but did not sign.
 * - **The business signs first.** Without its stored signature ready to apply,
 *   the quote is approved with the button instead, and signing it is refused.
 * - **Both signatures land on the contract**, which completes and freezes.
 * - **Tapping twice is not an error.** The second sign finds the first contract.
 * - **The setting is part of what was agreed** — frozen with the quote.
 *
 * Its own transactions commit, so the fixtures are real rows in a throwaway
 * shop, removed at the end.
 *
 *     npm run signing:quote-check
 */

import assert from "node:assert/strict";
import { eq, sql } from "drizzle-orm";

import { db } from "@/lib/db";
import { organizations } from "@/lib/db/schema/office";
import { recordShareView } from "@/lib/documents/operations/record-view";
import { resolveShareToken } from "@/lib/queries/share";
import { signQuoteFromLink } from "@/lib/share/sign-quote";
import { certificateFor } from "@/lib/signing/certificate";

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

async function refuses(label: string, run: () => Promise<unknown>, expect?: RegExp) {
  try {
    await run();
    check(label, false, "it was allowed");
  } catch (error) {
    // Drizzle wraps a database refusal as "Failed query", with the trigger's
    // own words on the cause.
    const cause = error instanceof Error && error.cause instanceof Error ? ` ${error.cause.message}` : "";
    const message = (error instanceof Error ? error.message : String(error)) + cause;
    check(label, expect ? expect.test(message) : true, message);
  }
}

const SLUG = `quote-sign-check-${Date.now()}`;
const audit = { ip: "203.0.113.7", userAgent: "quote-signing-check" };
const drawn = { kind: "drawn" as const, paths: ["M 10 60 Q 80 10 160 60", "M 180 40 L 260 70"] };

/** A sent quote with a live accept link, in the fixture shop. */
async function sentQuote(
  orgId: string,
  { lines = true, title = "Panel upgrade" }: { lines?: boolean; title?: string } = {}
) {
  const [customer] = await db.execute<{ id: string }>(
    sql`insert into customers (organization_id, name, email)
        values (${orgId}, 'Dana Whitfield', 'dana@example.com') returning id`
  );
  const [job] = await db.execute<{ id: string }>(
    sql`insert into jobs (organization_id, customer_id, name)
        values (${orgId}, ${customer.id}, ${title}) returning id`
  );
  const [quote] = await db.execute<{ id: string }>(
    sql`insert into documents
          (organization_id, job_id, customer_id, type, status, title, header_snapshot)
        values (${orgId}, ${job.id}, ${customer.id}, 'quote', 'sent', ${title},
                '{"businessName":"Mercer Electric","customerName":"Dana Whitfield","capturedAt":"2026-09-24T00:00:00Z"}'::jsonb)
        returning id`
  );
  await db.execute(
    sql`insert into quote_details (document_id, deposit_percent, signature_lines)
        values (${quote.id}, 30, ${lines})`
  );
  await db.execute(
    sql`insert into scope_nodes
          (organization_id, document_id, node_type, section, description,
           sell_price_cents, position)
        values (${orgId}, ${quote.id}, 'item', 'material', 'Service panel, 200A', 300000, 0)`
  );
  const token = `qsc-${quote.id}`;
  await db.execute(
    sql`insert into share_links (token, job_id, document_id, scopes)
        values (${token}, ${job.id}, ${quote.id}, '["view","accept"]'::jsonb)`
  );
  return { quoteId: quote.id, token };
}

async function statusOf(documentId: string) {
  const [row] = await db.execute<{ status: string }>(
    sql`select status from documents where id = ${documentId}`
  );
  return row?.status;
}

async function contractsOf(quoteId: string) {
  return db.execute<{ id: string; status: string }>(
    sql`select id, status from documents
         where source_document_id = ${quoteId} and type = 'contract'`
  );
}

const [org] = await db.execute<{ id: string }>(
  sql`insert into organizations (name, slug) values ('Mercer Electric', ${SLUG}) returning id`
);

try {
  console.log("");
  console.log("BEFORE THE BUSINESS HAS A SIGNATURE");
  {
    const { quoteId, token } = await sentQuote(org.id);
    const shared = await resolveShareToken(token);
    check(
      "the link offers the button, not signing",
      shared?.kind === "quote" && shared.signing === false
    );
    check(
      "the business's line is empty",
      shared?.kind === "quote" && shared.signatures.contractor === null
    );
    await refuses(
      "signing the quote is refused — she would be first to commit",
      () => signQuoteFromLink(token, { hash: shared?.kind === "quote" ? shared.hash : undefined, printedName: "Dana Whitfield", consented: true, mark: drawn }, audit),
      /hasn't signed/
    );
    check("...and the quote is untouched", (await statusOf(quoteId)) === "sent");
  }

  await db.execute(
    sql`insert into office_defaults (organization_id, signature_name, signature_mark, auto_sign_contracts)
        values (${org.id}, 'Sam Mercer', 'typed:Sam Mercer', true)`
  );

  console.log("");
  console.log("WITH THE BUSINESS'S SIGNATURE STORED");
  {
    const { quoteId, token } = await sentQuote(org.id);
    const shared = await resolveShareToken(token);
    check(
      "the link offers signing",
      shared?.kind === "quote" && shared.signing === true
    );
    check(
      "the business's line carries its stored signature, undated",
      shared?.kind === "quote" &&
        shared.signatures.contractor?.mark === "typed:Sam Mercer" &&
        shared.signatures.contractor.signedAt === null
    );

    await refuses(
      "a signature without consent is refused",
      () => signQuoteFromLink(token, { hash: shared?.kind === "quote" ? shared.hash : undefined, printedName: "Dana Whitfield", consented: false, mark: drawn }, audit),
      /electronically/
    );
    check(
      "...and it rolled back whole: no acceptance, no contract",
      (await statusOf(quoteId)) === "sent" && (await contractsOf(quoteId)).length === 0
    );

    const result = await signQuoteFromLink(
      token,
      { hash: shared?.kind === "quote" ? shared.hash : undefined, printedName: "Dana Whitfield", consented: true, mark: drawn },
      audit
    );
    check("signing completes the agreement", result.status === "signed", result.status);
    check("...and says where to go next", typeof result.next === "string" && result.next.length > 0);
    check("the quote is accepted", (await statusOf(quoteId)) === "accepted");

    const contracts = await contractsOf(quoteId);
    check("one contract was generated", contracts.length === 1, String(contracts.length));
    check("...signed by both, and so signed", contracts[0]?.status === "signed", contracts[0]?.status);

    const signatures = await db.execute<{
      party: string;
      printed_name: string;
      signature_kind: string;
      ip: string | null;
      document_hash: string | null;
      auth_method: string | null;
    }>(
      sql`select party, printed_name, signature_kind, ip, document_hash, auth_method
            from document_signatures where document_id = ${contracts[0].id}`
    );
    const business = signatures.find((s) => s.party === "contractor");
    const customer = signatures.find((s) => s.party === "customer");
    check("the business's stored signature is on it", business?.printed_name === "Sam Mercer");
    check(
      "...recording what it signed, like a signature taken by hand",
      Boolean(business?.document_hash) && business?.auth_method === "account"
    );
    const certificate = await certificateFor(contracts[0].id, org.id);
    check(
      "both signatures verify against the contract",
      certificate?.signatures.length === 2 &&
        certificate.signatures.every((s) => s.integrity.verified),
      certificate?.exceptions.join(" | ")
    );
    check(
      "the signing record has nothing to flag",
      certificate?.complete === true,
      certificate?.exceptions.join(" | ")
    );
    check(
      "hers is on it, drawn, with the request's audit trail",
      customer?.printed_name === "Dana Whitfield" &&
        customer.signature_kind === "drawn" &&
        customer.ip === audit.ip &&
        customer.auth_method === "share_link" &&
        Boolean(customer.document_hash)
    );

    const again = await signQuoteFromLink(
      token,
      { hash: shared?.kind === "quote" ? shared.hash : undefined, printedName: "Dana Whitfield", consented: true, mark: drawn },
      audit
    );
    check(
      "a second tap finds the first contract rather than making another",
      (await contractsOf(quoteId)).length === 1 && again.next !== null
    );

    const after = await resolveShareToken(token);
    check(
      "the accepted quote's lines show both recorded signatures",
      after?.kind === "quote" &&
        after.signing === false &&
        after.signatures.customer?.printedName === "Dana Whitfield" &&
        after.signatures.contractor?.signedAt !== null
    );

    await refuses(
      "the signature-lines setting is frozen with the accepted quote",
      () => db.execute(sql`update quote_details set signature_lines = false where document_id = ${quoteId}`),
      /frozen/
    );
  }

  console.log("");
  console.log("A QUOTE WITHOUT SIGNATURE LINES");
  {
    const { quoteId, token } = await sentQuote(org.id, { lines: false, title: "Outlet repair" });
    const shared = await resolveShareToken(token);
    check("the link offers the button", shared?.kind === "quote" && shared.signing === false);
    await refuses(
      "signing it is refused",
      () => signQuoteFromLink(token, { hash: shared?.kind === "quote" ? shared.hash : undefined, printedName: "Dana Whitfield", consented: true, mark: drawn }, audit),
      /button/
    );
    check("...and it is untouched", (await statusOf(quoteId)) === "sent");
  }

  console.log("");
  console.log("WITH AUTOMATIC SIGNING OFF");
  {
    await db.execute(
      sql`update office_defaults set auto_sign_contracts = false where organization_id = ${org.id}`
    );
    const { token } = await sentQuote(org.id, { title: "Sub-panel" });
    const shared = await resolveShareToken(token);
    check(
      "a stored signature the shop signs by hand is not drawn on the line",
      shared?.kind === "quote" && shared.signatures.contractor === null && shared.signing === false
    );
  }

  console.log("");
  console.log("OPENING THE LINK");
  {
    const { quoteId, token } = await sentQuote(org.id, { title: "Porch light" });
    const opened = await recordShareView(token);
    await recordShareView(token);
    await recordShareView(token);
    const [views] = await db.execute<{ n: number }>(
      sql`select count(*)::int n from share_link_views v
            join share_links l on l.id = v.share_link_id
           where l.token = ${token}`
    );
    check("opening it is an open", opened?.firstView === true);
    check("...and the quote reads as viewed", (await statusOf(quoteId)) === "viewed");
    check("reloading it is the same visit, not two more", views?.n === 1, String(views?.n));
  }
} finally {
  // Give the notification the acceptance fired a moment to find nobody.
  await new Promise((resolve) => setTimeout(resolve, 1500));
  await cleanup(org.id);
}

console.log("");
console.log(`${passed} passed, ${failures.length} failed`);
if (failures.length) {
  for (const failure of failures) console.log(`  - ${failure}`);
  process.exitCode = 1;
}
process.exit();

/**
 * Removes the throwaway shop. Frozen documents refuse ordinary deletes by
 * design, so — as in the change-order fixture — the guards are set aside for
 * this one transaction only, and only after checking it is ours.
 */
async function cleanup(id: string) {
  await db.transaction(async (tx) => {
    const [row] = await tx.select().from(organizations).where(eq(organizations.id, id));
    assert.ok(row?.slug === SLUG, "Cleanup must target only this script's shop");
    await tx.execute(sql`set local session_replication_role = replica`);

    const columns = await tx.execute<{ table_name: string; column_name: string }>(
      sql`select table_name, column_name from information_schema.columns
           where table_schema = 'public'
             and column_name in ('organization_id', 'document_id', 'job_id', 'share_link_id')
             and table_name not in ('organizations', 'documents', 'jobs')`
    );
    const docs = sql`(select id from documents where organization_id = ${id})`;
    const jobs = sql`(select id from jobs where organization_id = ${id})`;
    const links = sql`(select id from share_links where document_id in ${docs})`;

    for (const { table_name, column_name } of columns.filter((c) => c.column_name === "share_link_id")) {
      await tx.execute(sql`delete from ${sql.identifier(table_name)} where ${sql.identifier(column_name)} in ${links}`);
    }
    for (const { table_name, column_name } of columns.filter((c) => c.column_name !== "share_link_id")) {
      const within =
        column_name === "organization_id" ? sql`= ${id}` : column_name === "document_id" ? sql`in ${docs}` : sql`in ${jobs}`;
      await tx.execute(sql`delete from ${sql.identifier(table_name)} where ${sql.identifier(column_name)} ${within}`);
    }
    await tx.execute(sql`delete from documents where organization_id = ${id}`);
    await tx.execute(sql`delete from jobs where organization_id = ${id}`);
    await tx.delete(organizations).where(eq(organizations.id, id));
  });
}
