/**
 * Support requests, checked against a real database.
 *
 * - **What's sent is kept**, numbered, and shown back only to the sender.
 * - **The form's rules hold on the server**: a line and a story, and a page
 *   that is a path in the app — never a full address or a query string.
 * - **A Sentry event can be tied to a request only by its sender.**
 *
 * Nothing is emailed: the support inbox is switched off for the run. The rows
 * it writes are removed at the end, with the throwaway shop.
 *
 *     SUPPORT_CHECK_EMAIL=you@example.com npm run support:check
 */

import assert from "node:assert/strict";
import { eq, inArray, sql } from "drizzle-orm";

// Never email anyone from a check.
delete process.env.SUPPORT_EMAIL;

import { db } from "@/lib/db";
import { organizations } from "@/lib/db/schema/office";
import { supportRequests } from "@/lib/db/schema/support";
import { createSupportRequestSchema } from "@/lib/schemas/support";
import {
  createSupportRequest,
  linkSentryEvent,
  listSupportRequests,
  sentInLastHour,
  supportInboxConfigured,
} from "@/lib/support/service";

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

const email = process.env.SUPPORT_CHECK_EMAIL;
if (!email) {
  console.error("Set SUPPORT_CHECK_EMAIL to your own sign-in address.");
  process.exit(1);
}
const [me] = await db.execute<{ id: string }>(sql`select id from profiles where email = ${email} limit 1`);
if (!me) {
  console.error(`No profile for ${email}.`);
  process.exit(1);
}

const SLUG = `support-check-${Date.now()}`;
const [org] = await db.execute<{ id: string }>(
  sql`insert into organizations (name, slug) values ('Support Check', ${SLUG}) returning id`
);
const made: string[] = [];

try {
  console.log("");
  console.log("THE FORM'S RULES");
  const good = { kind: "bug", subject: "Board drag", body: "It landed in the wrong column.", page: "/tasks" };
  check("a line, a story and a path is fine", createSupportRequestSchema.safeParse(good).success);
  check("no line is refused", !createSupportRequestSchema.safeParse({ ...good, subject: "  " }).success);
  check("no story is refused", !createSupportRequestSchema.safeParse({ ...good, body: "" }).success);
  check("a full address as the page is refused", !createSupportRequestSchema.safeParse({ ...good, page: "https://evil.example/x" }).success);
  check("a query string as the page is refused", !createSupportRequestSchema.safeParse({ ...good, page: "/tasks?token=abc" }).success);
  check("a kind we don't have is refused", !createSupportRequestSchema.safeParse({ ...good, kind: "complaint" }).success);
  check("the inbox is off for this run", !supportInboxConfigured());

  console.log("");
  console.log("SENDING");
  const before = await sentInLastHour(me.id);
  const bug = await createSupportRequest({
    organizationId: org.id,
    userId: me.id,
    replyTo: email,
    userAgent: "support-check",
    request: { kind: "bug", subject: "  Board drag  ", body: "It landed in the wrong column.", page: "/tasks" },
  });
  made.push(bug.id);
  check("it's kept, trimmed", bug.subject === "Board drag" && bug.kind === "bug");
  check("it's numbered from 1001 up", bug.number >= 1001, String(bug.number));
  check("it starts as sent", bug.status === "open");
  check("with no inbox set, it says it wasn't emailed", bug.emailed === false);
  const idea = await createSupportRequest({
    organizationId: null,
    userId: me.id,
    replyTo: email,
    // "-check" marks the dashboard's log line test, since this one has no shop.
    userAgent: "support-check",
    request: { kind: "idea", subject: "Crew sign-ins", body: "My two guys need their own." },
  });
  made.push(idea.id);
  check("someone not in a shop yet is still heard", idea.number === bug.number + 1, `${idea.number} after ${bug.number}`);
  const logged = await db.execute<{ test: boolean }>(
    sql`select test from admin_events where data->>'request' in (${bug.id}, ${idea.id})`
  );
  check("the admin dashboard logs both, marked test", logged.length === 2 && [...logged].every((row) => row.test), JSON.stringify([...logged]));
  check("the hour's count goes up", (await sentInLastHour(me.id)) === before + 2);

  const [row] = await db.select().from(supportRequests).where(eq(supportRequests.id, bug.id));
  check("the page and the reply address are kept with it", row.page === "/tasks" && row.replyTo === email);

  console.log("");
  console.log("READING BACK");
  const mine = await listSupportRequests(me.id);
  check("the sender sees theirs, newest first", mine[0]?.id === idea.id && mine[1]?.id === bug.id);
  const theirs = await listSupportRequests("00000000-0000-4000-8000-000000000000");
  check("nobody else does", !theirs.some((request) => made.includes(request.id)));

  console.log("");
  console.log("TYING IN SENTRY");
  const eventId = "a".repeat(32);
  check("a stranger can't tie an event to it", !(await linkSentryEvent("00000000-0000-4000-8000-000000000000", bug.id, eventId)));
  check("the sender's browser can", await linkSentryEvent(me.id, bug.id, eventId));
  const [linked] = await db.select().from(supportRequests).where(eq(supportRequests.id, bug.id));
  check("and it's kept", linked.sentryEventId === eventId);
} finally {
  if (made.length) {
    // The admin dashboard's log lines about them go too — a check's requests
    // aren't anybody's news.
    await db.execute(sql`delete from admin_events where kind like 'support.%' and data->>'request' in (${sql.join(
      made.map((id) => sql`${id}`),
      sql`, `
    )})`);
    await db.delete(supportRequests).where(inArray(supportRequests.id, made));
  }
  await db.transaction(async (tx) => {
    const [row] = await tx.select().from(organizations).where(eq(organizations.id, org.id));
    assert.ok(row?.slug.startsWith(SLUG), "Cleanup must target only this script's shop");
    await tx.delete(organizations).where(eq(organizations.id, org.id));
  });
}

console.log("");
console.log(`${passed} passed, ${failures.length} failed`);
if (failures.length) {
  for (const failure of failures) console.log(`  - ${failure}`);
  process.exitCode = 1;
}
process.exit();
