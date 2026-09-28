import "server-only";

import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";

import { serverEnv } from "@/lib/env";

/**
 * Encryption for the credentials this product holds on somebody else's behalf.
 *
 * **A database dump must not be a set of live credentials for other people's
 * accounting systems.** That is the whole requirement, and it is why the key
 * lives in the environment rather than in a table: an attacker who gets the
 * database gets ciphertext, and an attacker who gets the environment usually
 * has the database too — so this defends the case that actually happens, which
 * is a leaked backup, a misconfigured replica, or a support engineer with read
 * access they should not have had.
 *
 * **AES-256-GCM, authenticated.** GCM rather than CBC because the tag proves
 * the ciphertext was not tampered with: a token that decrypts to *something*
 * but not the original would be a request signed with an attacker's value, and
 * an unauthenticated mode cannot tell the difference.
 *
 * **A fresh 96-bit IV per encryption, never reused.** IV reuse under GCM is
 * catastrophic rather than merely weak — it leaks the keystream and the
 * authentication key — so it is generated here and never derived from anything.
 *
 * The stored form is `v1.<iv>.<tag>.<ciphertext>`, all base64url. The version
 * prefix is what makes a key rotation or an algorithm change a migration rather
 * than a breaking change: a reader dispatches on it and can accept both while
 * rows are re-encrypted.
 */

const VERSION = "v1";
const IV_BYTES = 12;
const KEY_BYTES = 32;

let cachedKey: Buffer | undefined;

/**
 * The key, once.
 *
 * Required rather than optional: a connector that silently stored plaintext
 * because a variable was missing is worse than one that refuses to connect, and
 * this fails at the first use rather than at the first breach.
 */
function key(): Buffer {
  if (cachedKey) return cachedKey;

  const { CONNECTION_ENCRYPTION_KEY } = serverEnv();
  if (!CONNECTION_ENCRYPTION_KEY) {
    throw new Error(
      "CONNECTION_ENCRYPTION_KEY is not set. Generate one with " +
        "`openssl rand -base64 32` — connectors will not store credentials without it."
    );
  }

  const raw = Buffer.from(CONNECTION_ENCRYPTION_KEY, "base64");
  if (raw.length !== KEY_BYTES) {
    throw new Error(
      `CONNECTION_ENCRYPTION_KEY must decode to ${KEY_BYTES} bytes, got ${raw.length}. ` +
        "Generate one with `openssl rand -base64 32`."
    );
  }

  cachedKey = raw;
  return raw;
}

/** True when credentials can be stored at all. Lets a page explain the gap. */
export function encryptionConfigured(): boolean {
  try {
    key();
    return true;
  } catch {
    return false;
  }
}

export function encryptSecret(plaintext: string): string {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv("aes-256-gcm", key(), iv);

  const ciphertext = Buffer.concat([
    cipher.update(plaintext, "utf8"),
    cipher.final(),
  ]);

  return [
    VERSION,
    iv.toString("base64url"),
    cipher.getAuthTag().toString("base64url"),
    ciphertext.toString("base64url"),
  ].join(".");
}

export function decryptSecret(stored: string): string {
  const [version, iv, tag, ciphertext] = stored.split(".");

  if (version !== VERSION || !iv || !tag || !ciphertext) {
    throw new Error("Stored credential is not in a format this build reads.");
  }

  const decipher = createDecipheriv(
    "aes-256-gcm",
    key(),
    Buffer.from(iv, "base64url")
  );
  decipher.setAuthTag(Buffer.from(tag, "base64url"));

  return Buffer.concat([
    decipher.update(Buffer.from(ciphertext, "base64url")),
    decipher.final(),
  ]).toString("utf8");
}

/**
 * Constant-time comparison, for anything an attacker can submit repeatedly.
 *
 * A `===` on a webhook token leaks its prefix through timing. This is used for
 * the cron secret and for provider verifier tokens, both of which are guessable
 * one byte at a time otherwise.
 */
export function safeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  // `timingSafeEqual` throws on a length mismatch, which is itself a leak — so
  // the lengths are compared first and the result folded in.
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}
