import "server-only";

import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

import { serverEnv } from "@/lib/env";

/**
 * INVITE LINKS — signed, not stored.
 *
 * Supabase's own email links run out in an hour (a day at most), which is no
 * good for "there's an email waiting for you" read tomorrow. So the link we
 * mail is ours: the account, a nonce and an expiry, signed with a key derived
 * from the server's Supabase secret. Opening it mints a fresh Supabase sign-in
 * on the spot.
 *
 * **One live link per account.** The nonce also lives in the account's
 * `app_metadata.invite`; resending replaces it and accepting clears it, so an
 * old or used link stops working without a table of tokens.
 */

export const INVITE_DAYS = 14;

type Payload = { u: string; n: string; x: number };

function key() {
  const { SUPABASE_SECRET_KEY } = serverEnv();
  if (!SUPABASE_SECRET_KEY) throw new Error("SUPABASE_SECRET_KEY is required to sign invite links.");
  return createHmac("sha256", SUPABASE_SECRET_KEY).update("serviceclerk:invite-link:v1").digest();
}

function sign(body: string) {
  return createHmac("sha256", key()).update(body).digest("base64url");
}

export function newNonce() {
  return randomBytes(16).toString("base64url");
}

export function inviteToken(userId: string, nonce: string, expiresAt: Date) {
  const body = Buffer.from(JSON.stringify({ u: userId, n: nonce, x: Math.floor(expiresAt.getTime() / 1000) } satisfies Payload)).toString("base64url");
  return `${body}.${sign(body)}`;
}

/** The account and nonce a token names — or why it can't be used. */
export function readInviteToken(
  token: string,
  now = Date.now()
): { ok: true; userId: string; nonce: string } | { ok: false; reason: "invalid" | "expired" } {
  const [body, signature, extra] = token.split(".");
  if (!body || !signature || extra !== undefined) return { ok: false, reason: "invalid" };

  const expected = Buffer.from(sign(body));
  const given = Buffer.from(signature);
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return { ok: false, reason: "invalid" };

  let payload: Payload;
  try {
    payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as Payload;
  } catch {
    return { ok: false, reason: "invalid" };
  }
  if (typeof payload.u !== "string" || typeof payload.n !== "string" || typeof payload.x !== "number") {
    return { ok: false, reason: "invalid" };
  }
  if (payload.x * 1000 <= now) return { ok: false, reason: "expired" };
  return { ok: true, userId: payload.u, nonce: payload.n };
}
