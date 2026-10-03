import "server-only";

import { render } from "@react-email/components";
import { eq, sql } from "drizzle-orm";

import { db } from "@/lib/db";
import { accountPolicies } from "@/lib/db/schema";
import { sendEmail } from "@/lib/email/send";
import { InviteEmail } from "@/lib/email/templates/invite-email";
import { DomainError } from "@/lib/errors";
import { createAdminClient } from "@/lib/supabase/server";

import { log } from "./accounts";
import { inviteOrigin } from "./invite-origin";
import { INVITE_DAYS, inviteToken, newNonce, readInviteToken } from "./invite-token";
import type { Admin } from "./owners";

/**
 * INVITATIONS — an admin sets up a real account for someone and mails them the
 * way in.
 *
 * **The account exists from the moment of the invite**, confirmed (the link
 * reaching their inbox is the proof), with no password. What was set aside for
 * them is set on it straight away, so it's there however they first sign in —
 * through the invite, "Forgot password", or Google with the same address:
 *
 * - **Founding member** — `app_metadata.founding_member`. Founding prices when
 *   they subscribe, whether or not the public offer is open (§6); they still
 *   take one of its seats.
 * - **Free until** — a complimentary plan ending on a date, in the same
 *   account policy the panel already edits (`comp_plan` + `access_until`).
 *
 * The invite itself — who sent it, when, the live link's nonce, accepted or
 * not — lives in `app_metadata.invite`, beside the account it belongs to.
 */

export type InviteMeta = {
  nonce: string | null;
  sent_at: string;
  expires_at: string;
  by: string;
  message: string | null;
  accepted_at: string | null;
};

type AuthUser = {
  id: string;
  email?: string;
  last_sign_in_at?: string | null;
  banned_until?: string | null;
  user_metadata?: Record<string, unknown>;
  app_metadata?: Record<string, unknown>;
};

/* ── Sending ─────────────────────────────────────────────────────────── */

export async function inviteAccount(
  admin: Admin,
  input: {
    email: string;
    fullName: string | null;
    founding: boolean;
    freeUntil: string | null;
    message: string | null;
    send: boolean;
  },
  origin: string
) {
  origin = inviteOrigin(origin, process.env.NEXT_PUBLIC_SITE_URL, input.send);
  const email = input.email.trim().toLowerCase();
  const [existing] = await db.execute<{ id: string }>(sql`select id from auth.users where lower(email) = ${email} limit 1`);
  if (existing) {
    throw new DomainError(
      "There's already an account with that email — open it to give them founding pricing or a free period.",
      "conflict",
      { userId: existing.id }
    );
  }

  const nonce = newNonce();
  const expiresAt = new Date(Date.now() + INVITE_DAYS * 86_400_000);
  const invite: InviteMeta = {
    nonce,
    sent_at: new Date().toISOString(),
    expires_at: expiresAt.toISOString(),
    by: admin.email,
    message: input.message,
    accepted_at: null,
  };

  const { data, error } = await createAdminClient().auth.admin.createUser({
    email,
    // The invite reaching their inbox is the proof; there's nothing to confirm.
    email_confirm: true,
    user_metadata: input.fullName ? { full_name: input.fullName } : {},
    app_metadata: { invite, ...(input.founding ? { founding_member: true } : {}) },
  });
  if (error || !data.user) throw new DomainError(error?.message ?? "Supabase didn't create the account.", "invalid");
  const userId = data.user.id;

  if (input.freeUntil) {
    await db.insert(accountPolicies).values({
      userId,
      kind: "standard",
      compPlan: true,
      accessUntil: input.freeUntil,
      createdBy: admin.userId,
    });
  }

  await log("account.invited", "activity", userId, `${admin.email} invited ${email}`, admin, {
    founding: input.founding,
    free_until: input.freeUntil,
    emailed: input.send,
  });

  const link = `${origin}/invite/${inviteToken(userId, nonce, expiresAt)}`;
  const delivery = input.send ? await mailInvite(admin, userId, link) : { emailed: false, emailError: null };
  return { userId, email, link, expiresAt: expiresAt.toISOString(), ...delivery };
}

/** A new link for someone who hasn't accepted yet — the old one stops working. */
export async function resendInvite(admin: Admin, userId: string, send: boolean, origin: string) {
  origin = inviteOrigin(origin, process.env.NEXT_PUBLIC_SITE_URL, send);
  const user = await authUser(userId);
  if (!user?.email) throw new DomainError("No account with that id.", "not_found");
  if (user.last_sign_in_at) {
    throw new DomainError("They've already signed in, so there's nothing to accept. Send them to the sign-in page.", "conflict");
  }

  const previous = inviteOf(user);
  const nonce = newNonce();
  const expiresAt = new Date(Date.now() + INVITE_DAYS * 86_400_000);
  const invite: InviteMeta = {
    nonce,
    sent_at: new Date().toISOString(),
    expires_at: expiresAt.toISOString(),
    by: admin.email,
    message: previous?.message ?? null,
    accepted_at: null,
  };
  const { error } = await createAdminClient().auth.admin.updateUserById(userId, { app_metadata: { invite } });
  if (error) throw new DomainError(error.message, "failed");

  await log("account.invite_resent", "activity", userId, `${admin.email} sent ${user.email} a new invite link`, admin, { emailed: send });

  const link = `${origin}/invite/${inviteToken(userId, nonce, expiresAt)}`;
  const delivery = send ? await mailInvite(admin, userId, link) : { emailed: false, emailError: null };
  return { userId, email: user.email, link, expiresAt: expiresAt.toISOString(), ...delivery };
}

/** Founding pricing on or off for one account (§6). */
export async function setFoundingMember(admin: Admin, userId: string, on: boolean) {
  const user = await authUser(userId);
  if (!user) throw new DomainError("No account with that id.", "not_found");
  const { error } = await createAdminClient().auth.admin.updateUserById(userId, { app_metadata: { founding_member: on } });
  if (error) throw new DomainError(error.message, "failed");
  await log(
    on ? "account.founding_granted" : "account.founding_removed",
    "activity",
    userId,
    on ? `${admin.email} gave ${user.email} founding pricing` : `${admin.email} took founding pricing off ${user.email}`,
    admin
  );
}

async function mailInvite(admin: Admin, userId: string, link: string) {
  try {
    const user = await authUser(userId);
    if (!user?.email) throw new Error("The account has no email.");
    const [inviter] = await db.execute<{ full_name: string | null }>(sql`select full_name from profiles where id = ${admin.userId}`);
    const inviterName = inviter?.full_name?.trim() || admin.email;
    const fullName = typeof user.user_metadata?.full_name === "string" ? user.user_metadata.full_name.trim() : "";

    const element = InviteEmail({
      firstName: fullName ? fullName.split(/\s+/)[0] : null,
      inviter: inviterName,
      message: inviteOf(user)?.message ?? null,
      perks: await perksFor(user),
      url: link,
      days: INVITE_DAYS,
    });
    await sendEmail({
      to: user.email,
      subject: `${inviterName} invited you to try ServiceClerk`,
      html: await render(element),
      text: await render(element, { plainText: true }),
      replyTo: admin.email,
      fromName: "ServiceClerk",
    });
    return { emailed: true, emailError: null };
  } catch (error) {
    console.error("[invites] Email failed", userId, error);
    const message = error instanceof Error ? error.message : "The email didn't send.";
    const emailError = /not authorized to send emails from/i.test(message)
      ? "Resend rejected the sender domain. Set EMAIL_FROM to an address on the exact verified domain allowed by RESEND_API_KEY, or replace that key with one authorized for the sender domain. Then open this account and send a new invite."
      : message;
    return { emailed: false, emailError };
  }
}

/* ── Accepting ───────────────────────────────────────────────────────── */

export type InviteState =
  | { state: "ready"; email: string; firstName: string | null; inviter: string; perks: string[] }
  | { state: "used" | "expired" | "invalid" };

/** What the invite page shows. Reads only — accepting is a separate, deliberate POST. */
export async function readInvite(token: string): Promise<InviteState> {
  const checked = await check(token);
  if (!checked.ok) return { state: checked.state };
  const { user, invite } = checked;
  const fullName = typeof user.user_metadata?.full_name === "string" ? user.user_metadata.full_name.trim() : "";
  const [inviter] = await db.execute<{ full_name: string | null }>(
    sql`select p.full_name from profiles p join auth.users u on u.id = p.id where lower(u.email) = lower(${invite.by}) limit 1`
  );
  return {
    state: "ready",
    email: user.email!,
    firstName: fullName ? fullName.split(/\s+/)[0] : null,
    inviter: inviter?.full_name?.trim() || "The ServiceClerk team",
    perks: await perksFor(user),
  };
}

/**
 * Spends the invite: a one-off Supabase sign-in link for the account, which
 * the caller verifies on its own cookie client to start the session.
 */
export async function acceptInvite(token: string): Promise<{ ok: true; userId: string; email: string; tokenHash: string } | { ok: false; state: "used" | "expired" | "invalid" }> {
  const checked = await check(token);
  if (!checked.ok) return { ok: false, state: checked.state };
  const { user } = checked;

  const { data, error } = await createAdminClient().auth.admin.generateLink({ type: "magiclink", email: user.email! });
  if (error || !data.properties?.hashed_token) {
    console.error("[invites] Couldn't make a sign-in link", user.id, error);
    return { ok: false, state: "invalid" };
  }

  return { ok: true, userId: user.id, email: user.email!, tokenHash: data.properties.hashed_token };
}

/** After the session started: the link is spent, and the dashboard hears about it. */
export async function markInviteAccepted(userId: string) {
  const user = await authUser(userId);
  const invite = user ? inviteOf(user) : null;
  if (!user || !invite) return;
  await createAdminClient().auth.admin.updateUserById(userId, {
    app_metadata: { invite: { ...invite, nonce: null, accepted_at: new Date().toISOString() } },
  });
  await db.execute(
    sql`select public.admin_log('account.invite_accepted', 'milestone', null, ${userId}::uuid,
      ${`${user.email} accepted their invite`}, null, false, ${JSON.stringify({ by: invite.by })}::jsonb)`
  );
}

async function check(token: string): Promise<{ ok: true; user: AuthUser; invite: InviteMeta } | { ok: false; state: "used" | "expired" | "invalid" }> {
  const read = readInviteToken(token);
  if (!read.ok) return { ok: false, state: read.reason };
  const user = await authUser(read.userId);
  const invite = user ? inviteOf(user) : null;
  if (!user?.email || !invite) return { ok: false, state: "invalid" };
  if (user.banned_until && new Date(user.banned_until) > new Date()) return { ok: false, state: "invalid" };
  if (invite.accepted_at || user.last_sign_in_at) return { ok: false, state: "used" };
  // A newer link was sent; this one was replaced.
  if (invite.nonce !== read.nonce) return { ok: false, state: "invalid" };
  return { ok: true, user, invite };
}

/* ── Pieces ──────────────────────────────────────────────────────────── */

async function authUser(userId: string): Promise<AuthUser | null> {
  const { data, error } = await createAdminClient().auth.admin.getUserById(userId);
  if (error || !data.user) return null;
  return data.user as AuthUser;
}

function inviteOf(user: AuthUser): InviteMeta | null {
  const invite = user.app_metadata?.invite;
  return invite && typeof invite === "object" ? (invite as InviteMeta) : null;
}

/** What's been set aside for them, in the words the email and the invite page use. */
async function perksFor(user: AuthUser) {
  const perks: string[] = [];
  const [policy] = await db
    .select({ compPlan: accountPolicies.compPlan, accessUntil: accountPolicies.accessUntil })
    .from(accountPolicies)
    .where(eq(accountPolicies.userId, user.id))
    .limit(1);
  if (policy?.compPlan) {
    perks.push(
      policy.accessUntil
        ? `ServiceClerk Pro, free until ${new Date(`${policy.accessUntil}T12:00:00Z`).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric", timeZone: "UTC" })}`
        : "ServiceClerk Pro, free"
    );
  }
  if (user.app_metadata?.founding_member === true) {
    perks.push("Founding-member pricing, kept for as long as you stay subscribed");
  }
  return perks;
}
