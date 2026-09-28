/**
 * The signing module, checked against a real database.
 *
 * A signature is only worth the audit trail behind it, so these are the checks
 * that matter when somebody disputes a charge seven months later:
 *
 * - **Consent is required.** ESIGN §101(c) — a signature taken without recorded
 *   consent to electronic records is one the other side gets to argue about.
 * - **The hash is stable and content-bound.** The same document hashes the same
 *   way twice, a changed price hashes differently, and an internal cost
 *   correction does *not* — she never saw the cost, so it is not part of what
 *   she agreed to.
 * - **Path data is sanitized.** The stored value is rendered into an SVG `d`
 *   attribute, and anything that is not path data has no business reaching it.
 * - **The second signature completes and freezes** the contract, from a trigger.
 * - **The certificate can say something is wrong**, rather than only "verified".
 *
 *     npm run signing:check
 */

import { sql } from "drizzle-orm";

import { db } from "@/lib/db";
import { loadDocument } from "@/lib/documents/repository";
import { acceptQuote } from "@/lib/documents/operations/accept-quote";
import { canonical, documentHash } from "@/lib/signing/hash";
import { drawnMark, parseMark, typedMark } from "@/lib/signing/mark";
import { signDocument, canSign } from "@/lib/signing/sign";
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

async function refuses(
  label: string,
  run: () => Promise<unknown>,
  expect?: RegExp
) {
  try {
    await run();
    check(label, false, "it was allowed");
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    check(label, expect ? expect.test(message) : true, expect ? message : undefined);
  }
}

class Rollback extends Error {}

console.log("");
console.log("THE MARK");
{
  check("a typed name encodes", typedMark("Dana Whitfield") === "typed:Dana Whitfield");
  check(
    "...and reads back",
    parseMark("typed:Dana Whitfield").kind === "typed"
  );

  const drawn = drawnMark(["M 10 20 Q 30 40 50 60", "M 70 80 L 90 100"]);
  const parsed = parseMark(drawn);
  check("strokes encode as paths", parsed.kind === "drawn");
  check(
    "...and every stroke survives",
    parsed.kind === "drawn" && parsed.paths.length === 2,
    parsed.kind === "drawn" ? String(parsed.paths.length) : "not drawn"
  );

  // The stored value is rendered into an SVG `d` attribute. Anything that is
  // not path data reaching it is how a signature field becomes an injection
  // point, so the sanitizer is a security control rather than validation.
  await refuses(
    "script in the path data is refused",
    async () => drawnMark(['M 0 0" onload="alert(1)']),
    /could not be read/
  );
  await refuses(
    "so is an image payload",
    async () => drawnMark(["data:image/svg+xml;base64,PHN2Zz4="]),
    /could not be read/
  );
  await refuses("an empty signature is refused", async () => drawnMark([]), /Draw/);
  await refuses("so is an empty name", async () => typedMark("   "), /Type your name/);
}

try {
  await db
    .transaction(async (tx) => {
      const [org] = await tx.execute<{ id: string }>(
        sql`insert into organizations (name, slug)
            values ('Mercer Electric', ${`signing-check-${Date.now()}`})
            returning id`
      );
      const [customer] = await tx.execute<{ id: string }>(
        sql`insert into customers (organization_id, name, email)
            values (${org.id}, 'Dana Whitfield', 'dana@example.com') returning id`
      );
      const [job] = await tx.execute<{ id: string }>(
        sql`insert into jobs (organization_id, customer_id, name)
            values (${org.id}, ${customer.id}, 'Panel upgrade') returning id`
      );
      const [quote] = await tx.execute<{ id: string }>(
        sql`insert into documents
              (organization_id, job_id, customer_id, type, status, title,
               header_snapshot)
            values (${org.id}, ${job.id}, ${customer.id}, 'quote', 'sent',
                    'Panel upgrade',
                    '{"businessName":"Mercer Electric","customerName":"Dana Whitfield"}'::jsonb)
            returning id`
      );
      await tx.execute(
        sql`insert into quote_details (document_id, deposit_percent)
            values (${quote.id}, 30)`
      );
      const [node] = await tx.execute<{ id: string }>(
        sql`insert into scope_nodes
              (organization_id, document_id, node_type, section, description,
               sell_price_cents, unit_cost_cents, position)
            values (${org.id}, ${quote.id}, 'item', 'material',
                    'Service panel, 200A', 300000, 180000, 0)
            returning id`
      );

      console.log("");
      console.log("THE HASH");
      {
        const loaded = await loadDocument(quote.id, org.id, tx);
        const first = documentHash(loaded!);
        const second = documentHash(loaded!);
        check("the same document hashes the same way", first === second);
        check("it is a sha-256", /^[0-9a-f]{64}$/.test(first));
        check(
          "the canonical bytes are shown, not just the digest",
          canonical(loaded!).includes("Service panel, 200A")
        );

        // What she saw changed → the signature should no longer verify.
        await tx.execute(
          sql`update scope_nodes set sell_price_cents = 310000 where id = ${node.id}`
        );
        const repriced = await loadDocument(quote.id, org.id, tx);
        check("a changed price changes the hash", documentHash(repriced!) !== first);

        // What she never saw changed → it must not.
        const afterPrice = documentHash(repriced!);
        await tx.execute(
          sql`update scope_nodes set unit_cost_cents = 190000 where id = ${node.id}`
        );
        const recosted = await loadDocument(quote.id, org.id, tx);
        check(
          "an internal cost correction does not",
          documentHash(recosted!) === afterPrice
        );
      }

      console.log("");
      console.log("SIGNING A CONTRACT");
      {
        const contract = await acceptQuote(quote.id, org.id, { on: tx });
        check("an unsigned contract is signable", canSign(contract, "contractor"));

        await refuses(
          "not without consent",
          () =>
            signDocument({
              documentId: contract.id,
              organizationId: org.id,
              party: "contractor",
              printedName: "Ray Mercer",
              mark: { kind: "typed" },
              consented: false,
              authMethod: "account",
              on: tx,
            }),
          /Agree to sign electronically/
        );

        await refuses(
          "and not without a name",
          () =>
            signDocument({
              documentId: contract.id,
              organizationId: org.id,
              party: "contractor",
              printedName: "  ",
              mark: { kind: "typed" },
              consented: true,
              authMethod: "account",
              on: tx,
            }),
          /Type your name/
        );

        const first = await signDocument({
          documentId: contract.id,
          organizationId: org.id,
          party: "contractor",
          printedName: "Ray Mercer",
          mark: { kind: "drawn", paths: ["M 10 150 Q 100 50 200 150"] },
          consented: true,
          authMethod: "account",
          signerEmail: "ray@mercerelectric.com",
          ip: "203.0.113.7",
          userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Chrome/141.0",
          on: tx,
        });

        check("the contractor signs", first.signature.party === "contractor");
        check("the mark is stored as strokes", first.signature.signatureKind === "drawn");
        check("consent is dated", first.signature.consentedAt !== null);
        check("the content hash is captured", !!first.signature.documentHash);
        check("the address is recorded", first.signature.ip === "203.0.113.7");
        check(
          "one signature is not an agreement",
          first.document.status === "part_signed" && first.document.frozenAt === null
        );

        await refuses(
          "the same party cannot sign twice",
          () =>
            signDocument({
              documentId: contract.id,
              organizationId: org.id,
              party: "contractor",
              printedName: "Ray Mercer",
              mark: { kind: "typed" },
              consented: true,
              authMethod: "account",
              on: tx,
            }),
          /already carries a contractor signature/
        );

        const second = await signDocument({
          documentId: contract.id,
          organizationId: org.id,
          party: "customer",
          printedName: "Dana Whitfield",
          mark: { kind: "typed" },
          consented: true,
          authMethod: "share_link",
          signerEmail: "dana@example.com",
          ip: "198.51.100.22",
          userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0) Safari/605.1",
          on: tx,
        });

        check(
          "the second signature completes it",
          second.document.status === "signed"
        );
        check("...and freezes it", second.document.frozenAt !== null);
        check(
          "a frozen contract cannot be signed again",
          !canSign(second.document, "customer")
        );

        console.log("");
        console.log("THE CERTIFICATE");
        {
          const certificate = await certificateFor(contract.id, org.id, tx);

          check("it is produced", certificate !== null);
          check("both signatures are on it", certificate?.signatures.length === 2);
          check(
            "every signature verifies against the document",
            certificate!.signatures.every((s) => s.integrity.verified)
          );
          check(
            "the two authentication methods are told apart",
            certificate!.signatures.map((s) => s.authMethod).join(",") ===
              "account,share_link"
          );
          check("it reports complete", certificate!.complete === true);
          check("with no exceptions", certificate!.exceptions.length === 0);
          check(
            "the fingerprint is shown",
            /^[0-9a-f]{64}$/.test(certificate!.currentHash)
          );
        }

        console.log("");
        console.log("A QUOTE IS ACCEPTED, NOT SIGNED");
        await refuses(
          "signing a quote is refused with the reason",
          () =>
            signDocument({
              documentId: quote.id,
              organizationId: org.id,
              party: "customer",
              printedName: "Dana Whitfield",
              mark: { kind: "typed" },
              consented: true,
              authMethod: "share_link",
              on: tx,
            }),
          /accepted rather than signed/
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
