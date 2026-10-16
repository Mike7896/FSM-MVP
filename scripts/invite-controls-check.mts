/**
 * Resending, correcting, extending and withdrawing invites — against the dev
 * Supabase, on throwaway @example.com accounts it deletes afterwards.
 *
 *     npm run invite:controls-check
 */

import { sql } from "drizzle-orm";

import { getAccount, updatePolicy } from "@/lib/admin/accounts";
import { addMonths } from "@/lib/admin/free-time";
import { inviteAccount, readInvite, resendInvite, withdrawInvite } from "@/lib/admin/invites";
import { INVITE_NOTE_MAX, inviteAccountSchema } from "@/lib/schemas/admin";
import { db } from "@/lib/db";
import { createAdminClient } from "@/lib/supabase/server";

let passed = 0;
const failures: string[] = [];
function check(label: string, condition: boolean, detail?: unknown) {
  if (condition) {
    passed += 1;
    console.log(`  ok   ${label}`);
  } else {
    failures.push(label);
    console.log(`  FAIL ${label}${detail === undefined ? "" : ` — ${JSON.stringify(detail)}`}`);
  }
}

const run = Date.now();
const users: string[] = [];
const supabase = createAdminClient();

// A throwaway admin to act as — the log names whoever acts.
const actor = await supabase.auth.admin.createUser({ email: `invite-controls-${run}-admin@example.com`, email_confirm: true });
if (!actor.data.user) throw new Error(actor.error?.message ?? "Couldn't make the acting admin.");
users.push(actor.data.user.id);
const admin = { userId: actor.data.user.id, email: actor.data.user.email!, owner: false };
const origin = "http://localhost:3000";
const day = (offset: number) => new Date(Date.now() + offset * 86_400_000).toISOString().slice(0, 10);

try {
  const first = `invite-controls-${run}@example.com`;
  const fixed = `invite-controls-${run}-fixed@example.com`;
  const sent = await inviteAccount(
    admin,
    { email: first, fullName: "Check Person", founding: true, freeUntil: day(30), message: "first note", send: false },
    origin
  );
  users.push(sent.userId);
  const firstToken = sent.link.split("/invite/")[1];
  check("invite link works", (await readInvite(firstToken)).state === "ready");
  check("note shows on the account", (await getAccount(sent.userId))?.invite?.message === "first note");

  // Resend to a corrected address with a new note.
  const resent = await resendInvite(admin, sent.userId, { send: false, email: fixed, message: "second note" }, origin);
  const { data } = await supabase.auth.admin.getUserById(sent.userId);
  check("resend returns the corrected address", resent.email === fixed, resent.email);
  check("account's email moved", data.user?.email === fixed, data.user?.email);
  check("moved email is confirmed", Boolean(data.user?.email_confirmed_at));
  check("no pending email change", !data.user?.new_email, data.user?.new_email);
  check("note replaced", (await getAccount(sent.userId))?.invite?.message === "second note");
  check("note kept off their sign-in", !(data.user?.app_metadata?.invite as { message?: string })?.message);
  check("founding kept", data.user?.app_metadata?.founding_member === true);
  check("old link stops working", (await readInvite(firstToken)).state === "invalid");
  const secondToken = resent.link.split("/invite/")[1];
  const ready = await readInvite(secondToken);
  check("new link works, at the new address", ready.state === "ready" && ready.email === fixed, ready);

  // Leaving the note out keeps it.
  await resendInvite(admin, sent.userId, { send: false }, origin);
  check("note kept when left out", (await getAccount(sent.userId))?.invite?.message === "second note");

  // A page-long note goes through; one past the limit doesn't.
  const long = "Long note line.\n".repeat(Math.floor(INVITE_NOTE_MAX / 16));
  await resendInvite(admin, sent.userId, { send: false, message: long.trim() }, origin);
  check("long note saved whole", (await getAccount(sent.userId))?.invite?.message === long.trim());
  const tooLong = inviteAccountSchema.safeParse({ email: "x@example.com", message: "x".repeat(INVITE_NOTE_MAX + 1) });
  check("note over the limit refused", !tooLong.success);
  await resendInvite(admin, sent.userId, { send: false, message: null }, origin);
  check("note cleared", (await getAccount(sent.userId))?.invite?.message === null);

  // Someone else's address is refused.
  const taken = await resendInvite(admin, sent.userId, { send: false, email: admin.email }, origin).then(
    () => null,
    (error: Error) => error.message
  );
  check("taken address refused", taken === "There's already another account with that email.", taken);

  // More free time, logged in words.
  const until = addMonths(day(30), 2);
  await updatePolicy(admin, sent.userId, { compPlan: true, accessUntil: until });
  const [event] = await db.execute<{ title: string; test: boolean }>(
    sql`select title, test from admin_events where data->>'target' = ${sent.userId} and kind = 'account.policy_changed' order by id desc limit 1`
  );
  check("free time change logged plainly", Boolean(event?.title.includes("free Pro to run through")), event?.title);
  check("logged as test", event?.test === true);
  const [policy] = await db.execute<{ access_until: string; comp_plan: boolean }>(
    sql`select access_until::text, comp_plan from account_policies where user_id = ${sent.userId}`
  );
  check("free date saved", policy?.access_until === until && policy.comp_plan, policy);

  // Withdraw: the account and its policy go.
  await withdrawInvite(admin, sent.userId);
  const { data: gone } = await supabase.auth.admin.getUserById(sent.userId);
  check("withdrawn account deleted", !gone.user);
  const [orphan] = await db.execute(sql`select 1 from account_policies where user_id = ${sent.userId}`);
  check("its policy went with it", !orphan);
  users.splice(users.indexOf(sent.userId), 1);

  // Withdraw is refused once they've signed in.
  const other = await inviteAccount(
    admin,
    { email: `invite-controls-${run}-b@example.com`, fullName: null, founding: false, freeUntil: null, message: null, send: false },
    origin
  );
  users.push(other.userId);
  await db.execute(sql`update auth.users set last_sign_in_at = now() where id = ${other.userId}`);
  const refused = await withdrawInvite(admin, other.userId).then(
    () => null,
    (error: Error) => error.message
  );
  check("withdraw refused after sign-in", Boolean(refused?.startsWith("They've already signed in")), refused);
} finally {
  for (const id of users) await supabase.auth.admin.deleteUser(id);
  console.log(`\n${passed} passed, ${failures.length} failed`);
  process.exit(failures.length ? 1 : 0);
}
