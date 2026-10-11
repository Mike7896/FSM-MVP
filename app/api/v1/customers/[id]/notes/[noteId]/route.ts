import { and, eq } from "drizzle-orm";

import { requireCaller, requireOrg } from "@/lib/api/auth";
import { handlerWithParams } from "@/lib/api/handler";
import { ApiError, noContent } from "@/lib/api/response";
import { db } from "@/lib/db";
import { customerNotes } from "@/lib/db/schema";

/**
 * `/api/v1/customers/[id]/notes/[noteId]`
 *
 * Removing a note. Whoever wrote it can, and so can an owner or admin — a
 * technician shouldn't be able to erase what the office wrote down.
 */
export const DELETE = handlerWithParams<{ id: string; noteId: string }>(
  async (request, { id, noteId }) => {
    const caller = await requireCaller(request);
    const { organizationId, role } = await requireOrg(request, caller);

    const [note] = await db
      .select({ id: customerNotes.id, createdBy: customerNotes.createdBy })
      .from(customerNotes)
      .where(
        and(
          eq(customerNotes.id, noteId),
          eq(customerNotes.customerId, id),
          eq(customerNotes.organizationId, organizationId)
        )
      )
      .limit(1);

    if (!note) {
      throw new ApiError("not_found", "No note with that id on this customer.");
    }

    const manager = role === "owner" || role === "admin";
    if (!manager && note.createdBy !== caller.userId) {
      throw new ApiError(
        "forbidden",
        "Only whoever wrote this note, an owner or an admin can remove it."
      );
    }

    await db.delete(customerNotes).where(eq(customerNotes.id, note.id));

    return noContent();
  }
);
