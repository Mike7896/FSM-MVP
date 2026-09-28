import "server-only";

import { randomInt } from "node:crypto";
import { and, eq, isNull, lt, sql } from "drizzle-orm";

import { db } from "@/lib/db";
import { accountPolicies, platformAdmins } from "@/lib/db/schema";
import { DomainError } from "@/lib/errors";
import { createAdminClient } from "@/lib/supabase/server";

import { isOwnerEmail, type Admin } from "./owners";

/**
 * ACCOUNTS — the admin panel's view of every person, and what it can do to one.
 *
 * **Supabase Auth owns identity; this owns policy.** Creating a person, setting
 * a password and suspending sign-in go through Supabase's admin API, so
 * passwords are only ever hashed by Supabase (bcrypt) and a suspension is
 * enforced by the auth server itself — a banned person can't sign in or
 * refresh, and every request re-checks with it. What we keep is why: tester or
 * not, complimentary plan, limits, and who suspended whom for what.
 *
 * **Every change is written to the admin log**, with who made it, so the live
 * feed doubles as the audit trail.
 *
 * **Owners can't be touched from here** — not suspended, not demoted, no
 * password set — so a mistake in the panel can't lock out the people who run
 * it. Nobody can suspend or demote themselves either.
 */

export type AccountPolicyView = {
  kind: "standard" | "tester";
  compPlan: boolean;
  accessUntil: string | null;
  dailySendLimit: number | null;
  note: string | null;
  bannedAt: string | null;
  bannedReason: string | null;
};

export type AccountRow = {
  id: string;
  email: string;
  name: string | null;
  createdAt: string;
  lastSignInAt: string | null;
  confirmedAt: string | null;
  providers: string[];
  hasPassword: boolean;
  bannedUntil: string | null;
  businesses: { id: string; name: string; role: string }[];
  plan: string | null;
  admin: boolean;
  owner: boolean;
  policy: AccountPolicyView | null;
  sends7d: number;
  lastSeen: string | null;
};

export type AccountFilter = "all" | "admins" | "testers" | "suspended";

/* ── Reading ──────────────────────────────────────────────────────────── */

export async function listAccounts({ q, filter = "all" }: { q?: string; filter?: AccountFilter } = {}) {
  const term = q?.trim() ? `%${q.trim().replace(/[%_\\]/g, "\\$&")}%` : null;
  const rows = await db.execute<Record<string, unknown>>(sql`
    select u.id, u.email, p.full_name, u.created_at, u.last_sign_in_at, u.email_confirmed_at, u.banned_until,
      (coalesce(u.encrypted_password, '') <> '') as has_password,
      (select coalesce(json_agg(distinct i.provider), '[]'::json) from auth.identities i where i.user_id = u.id) as providers,
      (select coalesce(json_agg(json_build_object('id', o.id, 'name', o.name, 'role', m.role)), '[]'::json)
         from memberships m join organizations o on o.id = m.organization_id where m.user_id = u.id) as businesses,
      (select s.status::text from subscriptions s join memberships m on m.organization_id = s.organization_id
         where m.user_id = u.id order by s.created_at desc limit 1) as plan,
      exists (select 1 from platform_admins a where a.user_id = u.id) as admin,
      ap.kind, ap.comp_plan, ap.access_until, ap.daily_send_limit, ap.note, ap.banned_at, ap.banned_reason,
      (select count(*) from document_sends s where s.sent_by = u.id and s.sent_at > now() - interval '7 days')::int as sends_7d,
      (select up.last_seen from user_presence up where up.user_id = u.id) as last_seen
    from auth.users u
    left join profiles p on p.id = u.id
    left join account_policies ap on ap.user_id = u.id
    where (${term}::text is null
        or u.email ilike ${term} or p.full_name ilike ${term}
        or exists (select 1 from memberships m join organizations o on o.id = m.organization_id
                   where m.user_id = u.id and o.name ilike ${term}))
      and (${filter} = 'all'
        or (${filter} = 'admins' and exists (select 1 from platform_admins a where a.user_id = u.id))
        or (${filter} = 'testers' and ap.kind = 'tester')
        or (${filter} = 'suspended' and (ap.banned_at is not null or u.banned_until > now())))
    order by u.created_at desc
    limit 300
  `);
  return [...rows].map(toRow);
}

export async function getAccount(userId: string) {
  const [row] = await db.execute<Record<string, unknown>>(sql`
    select u.id, u.email, p.full_name, u.created_at, u.last_sign_in_at, u.email_confirmed_at, u.banned_until,
      (coalesce(u.encrypted_password, '') <> '') as has_password,
      (select coalesce(json_agg(distinct i.provider), '[]'::json) from auth.identities i where i.user_id = u.id) as providers,
      (select coalesce(json_agg(json_build_object('id', o.id, 'name', o.name, 'role', m.role)), '[]'::json)
         from memberships m join organizations o on o.id = m.organization_id where m.user_id = u.id) as businesses,
      (select s.status::text from subscriptions s join memberships m on m.organization_id = s.organization_id
         where m.user_id = u.id order by s.created_at desc limit 1) as plan,
      exists (select 1 from platform_admins a where a.user_id = u.id) as admin,
      ap.kind, ap.comp_plan, ap.access_until, ap.daily_send_limit, ap.note, ap.banned_at, ap.banned_reason,
      (select count(*) from document_sends s where s.sent_by = u.id and s.sent_at > now() - interval '7 days')::int as sends_7d,
      (select up.last_seen from user_presence up where up.user_id = u.id) as last_seen
    from auth.users u
    left join profiles p on p.id = u.id
    left join account_policies ap on ap.user_id = u.id
    where u.id = ${userId}
  `);
  if (!row) return null;

  const activity = await db.execute<Record<string, unknown>>(sql`
    select id, occurred_at, kind, level, title, org_name
    from admin_events
    where not test
      and (user_id = ${userId}
       or organization_id in (select organization_id from memberships where user_id = ${userId})
       or data->>'target' = ${userId})
    order by id desc limit 40
  `);
  return { ...toRow(row), activity: [...activity].map((event) => ({
    id: Number(event.id),
    occurredAt: iso(event.occurred_at)!,
    kind: String(event.kind),
    level: String(event.level),
    title: String(event.title),
    orgName: event.org_name ? String(event.org_name) : null,
  })) };
}

/* ── Test accounts ────────────────────────────────────────────────────── */

export async function createTestAccount(
  admin: Admin,
  input: {
    email: string;
    fullName: string | null;
    password: string | null;
    accessUntil: string | null;
    dailySendLimit: number | null;
    compPlan: boolean;
    note: string | null;
  }
) {
  const email = input.email.trim().toLowerCase();
  const [existing] = await db.execute<{ id: string }>(sql`select id from auth.users where lower(email) = ${email} limit 1`);
  if (existing) {
    throw new DomainError("There's already an account with that email.", "conflict", { userId: existing.id });
  }

  const password = input.password ?? generatePassword();
  const { data, error } = await createAdminClient().auth.admin.createUser({
    email,
    password,
    // They were given the account; there's no inbox to prove.
    email_confirm: true,
    user_metadata: input.fullName ? { full_name: input.fullName } : {},
    app_metadata: { tester: true },
  });
  if (error || !data.user) {
    throw new DomainError(error?.message ?? "Supabase didn't create the account.", "invalid");
  }

  await db.insert(accountPolicies).values({
    userId: data.user.id,
    kind: "tester",
    compPlan: input.compPlan,
    accessUntil: input.accessUntil,
    dailySendLimit: input.dailySendLimit,
    note: input.note,
    createdBy: admin.userId,
  });

  await log("account.tester_created", "activity", data.user.id, `${admin.email} made a test account for ${email}`, admin, {
    access_until: input.accessUntil,
    daily_send_limit: input.dailySendLimit,
    comp_plan: input.compPlan,
  });

  return { userId: data.user.id, email, password };
}

/* ── Policy ───────────────────────────────────────────────────────────── */

export async function updatePolicy(
  admin: Admin,
  userId: string,
  change: Partial<Pick<AccountPolicyView, "kind" | "compPlan" | "accessUntil" | "dailySendLimit" | "note">>
) {
  const target = await mustFind(userId);
  await db
    .insert(accountPolicies)
    .values({
      userId,
      kind: change.kind ?? "standard",
      compPlan: change.compPlan ?? false,
      accessUntil: change.accessUntil ?? null,
      dailySendLimit: change.dailySendLimit ?? null,
      note: change.note ?? null,
      createdBy: admin.userId,
    })
    .onConflictDoUpdate({
      target: accountPolicies.userId,
      set: {
        ...(change.kind !== undefined ? { kind: change.kind } : {}),
        ...(change.compPlan !== undefined ? { compPlan: change.compPlan } : {}),
        ...(change.accessUntil !== undefined ? { accessUntil: change.accessUntil } : {}),
        ...(change.dailySendLimit !== undefined ? { dailySendLimit: change.dailySendLimit } : {}),
        ...(change.note !== undefined ? { note: change.note } : {}),
        updatedAt: new Date(),
      },
    });
  await log("account.policy_changed", "activity", userId, `${admin.email} changed ${target.email}'s account settings`, admin, change);
}

/* ── Admins ───────────────────────────────────────────────────────────── */

export async function setAdmin(admin: Admin, userId: string, on: boolean) {
  const target = await mustFind(userId);
  if (isOwnerEmail(target.email)) {
    throw new DomainError("Owners are set in ADMIN_EMAILS on the server, not here.", "forbidden");
  }
  if (!on && userId === admin.userId) {
    throw new DomainError("You can't take away your own admin access.", "forbidden");
  }
  if (target.bannedUntil && new Date(target.bannedUntil) > new Date() && on) {
    throw new DomainError("Lift the suspension before making them an admin.", "conflict");
  }

  if (on) {
    await db
      .insert(platformAdmins)
      .values({ userId, email: target.email.toLowerCase(), grantedBy: admin.userId })
      .onConflictDoNothing();
  } else {
    await db.delete(platformAdmins).where(eq(platformAdmins.userId, userId));
  }
  await log(
    on ? "admin.granted" : "admin.revoked",
    on ? "activity" : "problem",
    userId,
    on ? `${admin.email} made ${target.email} an admin` : `${admin.email} removed ${target.email} as an admin`,
    admin
  );
}

/* ── Suspension ───────────────────────────────────────────────────────── */

/** About a hundred years — Supabase's ban is a duration, and this one doesn't end on its own. */
const FOREVER = "876000h";

export async function suspendAccount(admin: Admin | null, userId: string, reason: string) {
  const target = await mustFind(userId);
  if (isOwnerEmail(target.email)) throw new DomainError("Owners can't be suspended from the panel.", "forbidden");
  if (admin && userId === admin.userId) throw new DomainError("You can't suspend yourself.", "forbidden");

  const { error } = await createAdminClient().auth.admin.updateUserById(userId, { ban_duration: FOREVER });
  if (error) throw new DomainError(error.message, "failed");
  // The ban stops new sign-ins; ending their sessions signs out what's already
  // open — every request re-checks its session with the auth server.
  await db.execute(sql`delete from auth.sessions where user_id = ${userId}`);

  await db
    .insert(accountPolicies)
    .values({ userId, bannedAt: new Date(), bannedReason: reason, bannedBy: admin?.userId ?? null })
    .onConflictDoUpdate({
      target: accountPolicies.userId,
      set: { bannedAt: new Date(), bannedReason: reason, bannedBy: admin?.userId ?? null, updatedAt: new Date() },
    });
  // A suspended person keeps no admin access, and the live feed stops at once.
  await db.delete(platformAdmins).where(eq(platformAdmins.userId, userId));

  await log(
    "account.suspended",
    "problem",
    userId,
    `${admin?.email ?? "The tester sweep"} suspended ${target.email}: ${reason}`,
    admin
  );
}

export async function liftSuspension(admin: Admin, userId: string) {
  const target = await mustFind(userId);
  const { error } = await createAdminClient().auth.admin.updateUserById(userId, { ban_duration: "none" });
  if (error) throw new DomainError(error.message, "failed");
  await db
    .update(accountPolicies)
    .set({ bannedAt: null, bannedReason: null, bannedBy: null, updatedAt: new Date() })
    .where(eq(accountPolicies.userId, userId));
  await log("account.unsuspended", "activity", userId, `${admin.email} lifted ${target.email}'s suspension`, admin);
}

/* ── Passwords ────────────────────────────────────────────────────────── */

/**
 * A new password, shown once to the admin to pass on. Only for accounts that
 * already sign in with a password — putting one on somebody's Google-only
 * account would open a door they never asked for.
 */
export async function resetPassword(admin: Admin, userId: string) {
  const target = await mustFind(userId);
  if (isOwnerEmail(target.email)) throw new DomainError("Owners change their own password in Account.", "forbidden");
  if (!target.hasPassword) {
    throw new DomainError("This account signs in with Google only, so there's no password to set.", "conflict");
  }
  const password = generatePassword();
  const { error } = await createAdminClient().auth.admin.updateUserById(userId, { password });
  if (error) throw new DomainError(error.message, "failed");
  await log("account.password_reset", "activity", userId, `${admin.email} set a new password for ${target.email}`, admin);
  return { password };
}

/* ── Limits and the hourly sweep ──────────────────────────────────────── */

/** Testers past their last day are suspended, with that as the reason. */
export async function endExpiredTesters() {
  const expired = await db
    .select({ userId: accountPolicies.userId, until: accountPolicies.accessUntil })
    .from(accountPolicies)
    .where(
      and(
        eq(accountPolicies.kind, "tester"),
        isNull(accountPolicies.bannedAt),
        lt(accountPolicies.accessUntil, sql`current_date`)
      )
    );
  for (const tester of expired) {
    await suspendAccount(null, tester.userId, `Tester access ended ${tester.until}`).catch((error) =>
      console.error("Ending tester access failed", tester.userId, error)
    );
  }
  return expired.length;
}

/* ── Pieces ───────────────────────────────────────────────────────────── */

/** Four groups of four from letters and digits nobody misreads. */
export function generatePassword() {
  const alphabet = "abcdefghjkmnpqrstuvwxyz23456789";
  return Array.from({ length: 4 }, () =>
    Array.from({ length: 4 }, () => alphabet[randomInt(alphabet.length)]).join("")
  ).join("-");
}

async function mustFind(userId: string) {
  const account = await getAccount(userId);
  if (!account) throw new DomainError("No account with that id.", "not_found");
  return account;
}

async function log(
  kind: string,
  level: "activity" | "problem",
  target: string,
  title: string,
  admin: Admin | null,
  data: Record<string, unknown> = {}
) {
  await db.execute(
    sql`select public.admin_log(${kind}, ${level}, null, ${admin?.userId ?? null}::uuid, ${title}, null, false,
      ${JSON.stringify({ ...data, target, by: admin?.email ?? "system" })}::jsonb)`
  );
}

function toRow(row: Record<string, unknown>): AccountRow {
  const email = String(row.email ?? "");
  return {
    id: String(row.id),
    email,
    name: row.full_name ? String(row.full_name) : null,
    createdAt: iso(row.created_at)!,
    lastSignInAt: iso(row.last_sign_in_at),
    confirmedAt: iso(row.email_confirmed_at),
    providers: (row.providers as string[]) ?? [],
    hasPassword: Boolean(row.has_password),
    bannedUntil: iso(row.banned_until),
    businesses: (row.businesses as AccountRow["businesses"]) ?? [],
    plan: row.plan ? String(row.plan) : null,
    admin: Boolean(row.admin),
    owner: isOwnerEmail(email),
    policy: row.kind
      ? {
          kind: row.kind as "standard" | "tester",
          compPlan: Boolean(row.comp_plan),
          accessUntil: day(row.access_until),
          dailySendLimit: row.daily_send_limit === null || row.daily_send_limit === undefined ? null : Number(row.daily_send_limit),
          note: row.note ? String(row.note) : null,
          bannedAt: iso(row.banned_at),
          bannedReason: row.banned_reason ? String(row.banned_reason) : null,
        }
      : null,
    sends7d: Number(row.sends_7d ?? 0),
    lastSeen: iso(row.last_seen),
  };
}

function iso(value: unknown) {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(String(value));
  return Number.isFinite(date.getTime()) ? date.toISOString() : null;
}

/** A `date` column as "YYYY-MM-DD", whether the driver hands back text or a Date. */
function day(value: unknown) {
  if (!value) return null;
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  return String(value).slice(0, 10);
}
