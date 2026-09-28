import "server-only";

import { and, eq, gt, isNull, or } from "drizzle-orm";

import { db } from "@/lib/db";
import { documents, jobs, organizations, shareLinks } from "@/lib/db/schema";
import type {
  DocumentStatus,
  DocumentType,
  ShareScope,
} from "@/lib/documents";
import { DomainError } from "@/lib/errors";

/**
 * The document behind a customer's link, for the things done from it.
 *
 * **Possession is permission** (Object Model §5.7): no session, no account, and
 * the token is the whole authorization. So an action checks the token's own
 * facts — live, the right kind of document, a scope that grants this act — and
 * every refusal is the same answer. Telling a stranger that a token *used* to
 * work, or that it opens something else, is telling them a token exists.
 */

export type HeldLink = {
  documentId: string;
  organizationId: string;
  jobId: string;
  type: DocumentType;
  status: DocumentStatus;
  scopes: string[];
  /** Whose link it is, for the sentences a refusal owes the customer. */
  businessName: string | null;
};

export const DEAD_LINK =
  "This link isn't working any more. Ask whoever sent it for a new one.";

/**
 * Which kind of document a link opens, for a route that serves more than one.
 *
 * Only a routing hint: it proves nothing about the link, and whatever the
 * route calls next still goes through `heldLink` for the real checks. Null for
 * a token that doesn't exist, so a stranger learns nothing from the answer.
 */
export async function linkedType(token: string): Promise<DocumentType | null> {
  const [link] = await db
    .select({ type: documents.type })
    .from(shareLinks)
    .innerJoin(documents, eq(shareLinks.documentId, documents.id))
    .where(eq(shareLinks.token, token))
    .limit(1);

  return link?.type ?? null;
}

export async function heldLink(
  token: string,
  type: DocumentType,
  scope: ShareScope
): Promise<HeldLink> {
  const now = new Date();

  const [link] = await db
    .select({
      documentId: documents.id,
      organizationId: documents.organizationId,
      jobId: documents.jobId,
      type: documents.type,
      status: documents.status,
      scopes: shareLinks.scopes,
      demo: jobs.isDemo,
      businessName: organizations.name,
    })
    .from(shareLinks)
    .innerJoin(documents, eq(shareLinks.documentId, documents.id))
    .innerJoin(jobs, eq(documents.jobId, jobs.id))
    .innerJoin(organizations, eq(documents.organizationId, organizations.id))
    .where(
      and(
        eq(shareLinks.token, token),
        isNull(shareLinks.revokedAt),
        or(isNull(shareLinks.expiresAt), gt(shareLinks.expiresAt, now))
      )
    )
    .limit(1);

  // A demo went to the contractor alone. Nothing on it is ever agreed or paid,
  // however its link is used.
  if (
    !link ||
    link.type !== type ||
    link.demo ||
    !(link.scopes ?? []).includes(scope)
  ) {
    throw new DomainError(DEAD_LINK, "not_found");
  }

  return {
    documentId: link.documentId,
    organizationId: link.organizationId,
    jobId: link.jobId,
    type: link.type,
    status: link.status,
    scopes: link.scopes ?? [],
    businessName: link.businessName?.trim() || null,
  };
}
