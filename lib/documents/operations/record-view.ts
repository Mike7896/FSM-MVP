import "server-only";

import { and, desc, eq, gt, inArray, isNull } from "drizzle-orm";

import { db } from "@/lib/db";
import { documents, shareLinkViews, shareLinks } from "@/lib/db/schema";
import { notifyLater } from "@/lib/notifications";
import { reportError } from "@/lib/observability";

/**
 * A customer opened her link.
 *
 * "Opened twice, last at 9:14 PM" is the most useful sentence in the product for
 * a contractor deciding whether a call is worth making, and it is the one thing
 * a spreadsheet cannot tell him. So every open is a row, and the first one also
 * moves the document from `sent` to `viewed` — the status every dashboard row
 * reads.
 *
 * `viewed` is never merged into `sent`: "they haven't looked" and "they looked
 * and went quiet" are different facts that call for different moves. Only a
 * sent document advances — an accepted one must not fall backwards — and
 * `viewed_at` is one of the columns the freeze lets move, so an issued invoice
 * records its opening too.
 *
 * **A reload is not another open.** The page renders again whenever it is
 * refreshed — by her, by the browser coming back to the tab, by a signature
 * landing — and counting each render made one visit read as hundreds. Loads
 * within ten minutes of the last recorded one are the same visit.
 *
 * Deliberately fire-and-forget: a failed write here must never stop her seeing
 * the document. The caller decides whether an open counts at all — the
 * business's own people checking the link are not her.
 */
/** How close together two loads have to be to count as one visit. */
const SAME_VISIT_MS = 10 * 60_000;

export async function recordShareView(token: string): Promise<{
  documentId: string;
  firstView: boolean;
} | null> {
  try {
    const now = new Date();

    const [link] = await db
      .update(shareLinks)
      .set({ lastAccessedAt: now })
      .where(eq(shareLinks.token, token))
      .returning({ id: shareLinks.id, documentId: shareLinks.documentId });

    if (!link?.documentId) return null;

    const [recent] = await db
      .select({ id: shareLinkViews.id })
      .from(shareLinkViews)
      .where(
        and(
          eq(shareLinkViews.shareLinkId, link.id),
          gt(shareLinkViews.viewedAt, new Date(now.getTime() - SAME_VISIT_MS))
        )
      )
      .orderBy(desc(shareLinkViews.viewedAt))
      .limit(1);
    if (recent) return { documentId: link.documentId, firstView: false };

    await db
      .insert(shareLinkViews)
      .values({ shareLinkId: link.id, viewedAt: now });

    const [advanced] = await db
      .update(documents)
      .set({ status: "viewed", viewedAt: now })
      .where(and(eq(documents.id, link.documentId), eq(documents.status, "sent"), inArray(documents.type, ["quote", "invoice"])))
      .returning({
        organizationId: documents.organizationId,
        type: documents.type,
      });

    await db.update(documents).set({ viewedAt: now }).where(and(eq(documents.id, link.documentId), eq(documents.type, "change_order"), isNull(documents.viewedAt)));

    // Only the first open is news. The ones after it are on the quote's
    // timeline, which is where a contractor deciding whether to call looks.
    if (advanced?.type === "quote") {
      notifyLater({
        kind: "quote.viewed",
        organizationId: advanced.organizationId,
        documentId: link.documentId,
      });
    }

    return { documentId: link.documentId, firstView: advanced !== undefined };
  } catch (error) {
    reportError("[share] couldn't record the view:", error);
    return null;
  }
}
