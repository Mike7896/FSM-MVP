import "server-only";

import { and, desc, eq, ne } from "drizzle-orm";

import { db } from "@/lib/db";
import { documents } from "@/lib/db/schema";

/**
 * The invoice a change order was billed on, when it asked for one of its own.
 *
 * Only a change marked for separate billing gets one — the rest ride on the
 * next draw or the final balance — so null is the ordinary answer.
 */
export async function changeOrderInvoice(
  changeOrderId: string,
  organizationId: string
): Promise<{ id: string; number: string; status: string; createdAt: Date } | null> {
  const [invoice] = await db
    .select({
      id: documents.id,
      number: documents.number,
      status: documents.status,
      createdAt: documents.createdAt,
    })
    .from(documents)
    .where(
      and(
        eq(documents.sourceDocumentId, changeOrderId),
        eq(documents.organizationId, organizationId),
        eq(documents.type, "invoice"),
        ne(documents.status, "void")
      )
    )
    .orderBy(desc(documents.createdAt))
    .limit(1);

  return invoice ?? null;
}
