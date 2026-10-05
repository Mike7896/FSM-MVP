/**
 * Sending a copy of a contract, checked against a real database.
 *
 * What the page's "Send a copy" has to be true about:
 *
 * - **The same link, every time.** A second send returns the token the first
 *   one made. Two live links to one agreement is how somebody signs a document
 *   nobody is looking at.
 * - **Signing is on it.** The link carries `sign`, because an unsigned contract
 *   is sent in order to be signed.
 * - **Every send is recorded**, in `document_sends`, with who and what channel.
 * - **`sent_at` is filled once and never moved** — a resend is not a new send
 *   date, and the contract is frozen after signature anyway.
 * - **A demo contract has nowhere to go**, and an email send with no address
 *   says so instead of failing silently.
 *
 * Runs against a scratch organization, which is deleted at the end.
 *
 *     npm run contract-send:check
 */

import { sql } from "drizzle-orm";

import { db } from "@/lib/db";
// Concrete modules rather than the barrel: tsx loads the library as CJS, where
// named-export detection cannot see through `export * from`.
import { acceptQuote } from "@/lib/documents/operations/accept-quote";
import { sendContract } from "@/lib/documents/operations/send-contract";

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

/** Runs something that must throw, and reports the message it threw. */
async function refuses(label: string, run: () => Promise<unknown>, expect: RegExp) {
  try {
    await run();
    check(label, false, "it went through");
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    check(label, expect.test(message), message);
  }
}

let scratchOrg: string | null = null;

try {
  const [org] = await db.execute<{ id: string }>(
    sql`insert into organizations (name, slug)
        values ('Contract Send Check', ${`contract-send-check-${Date.now()}`})
        returning id`
  );
  scratchOrg = org.id;

  // `document_sends.sent_by` points at a real person, so the check borrows one
  // rather than inventing an id. Nothing is written outside the scratch org.
  const [user] = await db.execute<{ id: string }>(
    sql`select id from auth.users order by created_at limit 1`
  );
  if (!user) throw new Error("No users in this database to send as.");
  const sender = { userId: user.id, email: "sender@example.test" };

  /** A customer, a job, a sent quote with one priced row — then accept it. */
  async function newContract({
    demo,
    customerEmail,
  }: {
    demo: boolean;
    customerEmail: string | null;
  }) {
    const [customer] = await db.execute<{ id: string }>(
      sql`insert into customers (organization_id, name, email, is_demo)
          values (${org.id}, 'Dana Whitfield', ${customerEmail}, ${demo})
          returning id`
    );
    const [job] = await db.execute<{ id: string }>(
      sql`insert into jobs (organization_id, customer_id, name, is_demo)
          values (${org.id}, ${customer.id}, 'Panel upgrade', ${demo})
          returning id`
    );
    const [quote] = await db.execute<{ id: string }>(
      sql`insert into documents
            (organization_id, job_id, customer_id, type, status, title)
          values (${org.id}, ${job.id}, ${customer.id}, 'quote', 'sent', 'Panel upgrade')
          returning id`
    );
    await db.execute(
      sql`insert into quote_details (document_id) values (${quote.id})`
    );
    await db.execute(
      sql`insert into scope_nodes
            (organization_id, document_id, node_type, section, description,
             sell_price_cents, position)
          values (${org.id}, ${quote.id}, 'item', 'material',
                  'Service panel, 200A', 300000, 1)`
    );

    return acceptQuote(quote.id, org.id, { on: db });
  }

  console.log("\nSEND A COPY");
  {
    const contract = await newContract({
      demo: false,
      customerEmail: "dana@example.test",
    });

    const first = await sendContract({
      organizationId: org.id,
      contractId: contract.id,
      sender,
      input: { channel: "link" },
    });

    check("it hands back a share link", /\/share\/[A-Za-z0-9_-]+$/.test(first.url), first.url);
    check("nothing was emailed on the link channel", first.to === null);

    const token = first.url.split("/share/")[1];
    const [link] = await db.execute<{ scopes: string[]; document_id: string }>(
      sql`select scopes, document_id from share_links where token = ${token}`
    );
    check("the link is this contract's", link?.document_id === contract.id);
    check(
      "it can be signed from the link",
      Array.isArray(link?.scopes) && link.scopes.includes("sign"),
      JSON.stringify(link?.scopes)
    );

    const [afterFirst] = await db.execute<{ sent_at: string | null }>(
      sql`select sent_at from documents where id = ${contract.id}`
    );
    check("the contract is marked sent", afterFirst?.sent_at !== null);

    const second = await sendContract({
      organizationId: org.id,
      contractId: contract.id,
      sender,
      input: { channel: "link", message: "Second time, same link." },
    });
    check("a second send reuses the same link", second.url === first.url);

    const [afterSecond] = await db.execute<{ sent_at: string | null }>(
      sql`select sent_at from documents where id = ${contract.id}`
    );
    check(
      "the first send date doesn't move",
      afterSecond?.sent_at === afterFirst?.sent_at,
      `${afterFirst?.sent_at} -> ${afterSecond?.sent_at}`
    );

    const sends = await db.execute<{ channel: string; message: string | null }>(
      sql`select channel, message from document_sends
          where document_id = ${contract.id} order by sent_at`
    );
    check("both sends are recorded", sends.length === 2, `${sends.length}`);
    check(
      "the typed message is kept",
      sends[1]?.message === "Second time, same link.",
      String(sends[1]?.message)
    );
  }

  console.log("\nWHAT IT REFUSES");
  {
    const noAddress = await newContract({ demo: false, customerEmail: null });
    await refuses(
      "email with no address anywhere",
      () =>
        sendContract({
          organizationId: org.id,
          contractId: noAddress.id,
          sender,
          input: { channel: "email" },
        }),
      /Where should it go/
    );

    const demo = await newContract({ demo: true, customerEmail: null });
    await refuses(
      "a demo contract",
      () =>
        sendContract({
          organizationId: org.id,
          contractId: demo.id,
          sender,
          input: { channel: "link" },
        }),
      /demo job/
    );

    const [other] = await db.execute<{ id: string }>(
      sql`insert into organizations (name, slug)
          values ('Somebody Else', ${`other-check-${Date.now()}`}) returning id`
    );
    await refuses(
      "another shop's contract, by id",
      () =>
        sendContract({
          organizationId: other.id,
          contractId: noAddress.id,
          sender,
          input: { channel: "link" },
        }),
      /No contract with that id/
    );
    await db.execute(sql`delete from organizations where id = ${other.id}`);
  }
} finally {
  if (scratchOrg) {
    // A signed contract refuses to be deleted, which is exactly what the
    // freeze is for — so the guard comes off for the length of this one
    // delete and goes straight back on. Reported rather than thrown: a
    // cleanup failure must not hide the failure that caused it.
    try {
      await db.execute(
        sql`alter table public.documents disable trigger documents_freeze`
      );
      await db.execute(sql`delete from organizations where id = ${scratchOrg}`);
    } catch (error) {
      console.error("\n  cleanup failed — scratch org left behind:", error);
    } finally {
      await db.execute(
        sql`alter table public.documents enable trigger documents_freeze`
      );
    }
  }
  await db.$client.end({ timeout: 5 });
}

console.log(
  `\n${passed} passed, ${failures.length} failed.` +
    (failures.length ? `\n\n${failures.map((f) => `  - ${f}`).join("\n")}\n` : "\n")
);

process.exit(failures.length ? 1 : 0);
