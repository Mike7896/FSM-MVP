import "server-only";

import { asc, eq, sql } from "drizzle-orm";

import { db } from "@/lib/db";
import { documentSends, shareLinkViews, shareLinks } from "@/lib/db/schema";
import { liveShareLink, shareUrl } from "@/lib/documents";

/**
 * What has happened to a document since it went out — every send, every visit
 * to the customer's link, and the link itself.
 *
 * Read from the records that prove each one, never a status somebody set: the
 * sends from `document_sends`, the visits from the link's view rows. Shared by
 * every page that tells a document's story — the contract, a change order —
 * so "opened" means the same thing on all of them.
 *
 * **Takes a document id the caller has already scoped to its organization.**
 * There is no organization check here, the same as `liveShareLink`.
 */
export type DocumentActivity = {
  sends: { channel: string; recipient: string | null; sentAt: Date }[];
  /**
   * Each time the customer came to the link, oldest first. Loads within half
   * an hour of the one before are one sitting: the page renders again on
   * every refresh, and a reload is not somebody coming back to it.
   */
  visits: Date[];
  /** The link the customer holds. Null if there isn't one, or it's revoked. */
  url: string | null;
};

export async function documentActivity(
  documentId: string
): Promise<DocumentActivity> {
  const [sends, visits, link] = await Promise.all([
    db
      .select({
        channel: documentSends.channel,
        recipient: documentSends.recipient,
        sentAt: documentSends.sentAt,
      })
      .from(documentSends)
      .where(eq(documentSends.documentId, documentId))
      .orderBy(asc(documentSends.sentAt)),
    // Grouped in the query rather than the page, so every load is counted and
    // a long history is never cut short.
    db.execute<{ started_at: string }>(sql`
      select viewed_at as started_at from (
        select v.viewed_at,
               lag(v.viewed_at) over (order by v.viewed_at) as previous
          from ${shareLinkViews} v
          join ${shareLinks} l on l.id = v.share_link_id
         where l.document_id = ${documentId}
      ) loads
      where previous is null or viewed_at - previous > interval '30 minutes'
      order by viewed_at
    `),
    liveShareLink(documentId),
  ]);

  return {
    sends,
    visits: [...visits].map((visit) => new Date(visit.started_at)),
    url: link ? shareUrl(link.token) : null,
  };
}
