import "server-only";

import { randomBytes } from "node:crypto";

import { and, desc, eq, gt, isNull, or } from "drizzle-orm";

import { db } from "@/lib/db";
import { shareLinks } from "@/lib/db/schema";
import { absoluteUrl } from "@/lib/env";
import { commitDocumentPublication } from "@/lib/membership/activation";

import type { Executor } from "./repository";

/**
 * The link a customer holds — Object Model §5.7.
 *
 * **Possession is permission.** The token is unguessable and it is the whole
 * authorization: no account, no login, ever. So minting one is a real act, and
 * it happens here rather than wherever a send happens to need one.
 *
 * **One live link per document.** Sending again reuses the link she already
 * has rather than minting a second, so an improved quote improves the page she
 * is holding instead of leaving her an old copy — and revoking means one link,
 * not a hunt for several.
 */

/** What a holder may do. `view` is every link; the rest arrive with Flow 2. */
export type ShareScope = "view" | "accept" | "sign" | "pay" | "reply";

/** The document's live link, if it has one. */
export async function liveShareLink(documentId: string, on: Executor = db) {
  const [link]: { id: string; token: string; scopes: string[] }[] = await on
    .select({
      id: shareLinks.id,
      token: shareLinks.token,
      scopes: shareLinks.scopes,
    })
    .from(shareLinks)
    .where(
      and(eq(shareLinks.documentId, documentId), isNull(shareLinks.revokedAt), or(isNull(shareLinks.expiresAt), gt(shareLinks.expiresAt, new Date())))
    )
    .orderBy(desc(shareLinks.createdAt))
    .limit(1);

  return link ?? null;
}

/**
 * The live link, minted if there isn't one yet.
 *
 * A link that exists but lacks a scope this send needs is **widened** rather
 * than replaced: the customer keeps the URL she already has, and it simply
 * starts letting her do the next thing.
 */
export async function ensureShareLink(
  document: { id: string; jobId: string },
  scopes: ShareScope[],
  on: Executor = db
): Promise<{ token: string; url: string }> {
  if (on === db) return db.transaction(tx => ensureShareLink(document, scopes, tx));
  // The link and its activation either commit together or both roll back.
  // Later delivery/recording failures cannot release a published job's slot.
  await commitDocumentPublication(document.jobId, on);
  const live = await liveShareLink(document.id, on);

  if (live) {
    const missing = scopes.filter((scope) => !live.scopes.includes(scope));
    if (missing.length) {
      await on
        .update(shareLinks)
        .set({ scopes: [...live.scopes, ...missing] })
        .where(eq(shareLinks.id, live.id));
    }
    return { token: live.token, url: shareUrl(live.token) };
  }

  const token = randomBytes(24).toString("base64url");
  await on.insert(shareLinks).values({
    token,
    jobId: document.jobId,
    documentId: document.id,
    scopes,
  });

  return { token, url: shareUrl(token) };
}

export function shareUrl(token: string): string {
  return absoluteUrl(`/share/${token}`);
}
