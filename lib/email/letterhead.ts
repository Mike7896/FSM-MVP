import "server-only";

import { and, asc, eq } from "drizzle-orm";

import { db } from "@/lib/db";
import { licenses, organizations, type HeaderSnapshot } from "@/lib/db/schema";
import { headerCaptured } from "@/lib/documents/header";

import type { EmailLetterhead } from "./templates/document-email";

/**
 * The letterhead an email opens with.
 *
 * **The document's own, when it has one.** A contract or an invoice carries the
 * header it was issued under (Documents §2), and the email that links to it has
 * to say the same thing the page says — so the snapshot wins. A quote going out
 * for the first time has none yet, and reads the Office as it stands, which is
 * what the snapshot is about to be taken from.
 */
export async function letterheadFor(
  organizationId: string,
  header?: HeaderSnapshot | null
): Promise<EmailLetterhead> {
  if (header && headerCaptured(header)) {
    return {
      name: header.businessName ?? null,
      logoUrl: header.logoUrl ?? null,
      license: header.licenseNumber ?? null,
      phone: header.businessPhone ?? null,
    };
  }

  const [[office], [license]] = await Promise.all([
    db
      .select({
        name: organizations.name,
        phone: organizations.phone,
        logoUrl: organizations.logoUrl,
      })
      .from(organizations)
      .where(eq(organizations.id, organizationId))
      .limit(1),
    db
      .select({ number: licenses.number })
      .from(licenses)
      .where(
        and(
          eq(licenses.organizationId, organizationId),
          eq(licenses.status, "active")
        )
      )
      .orderBy(asc(licenses.createdAt))
      .limit(1),
  ]);

  return {
    name: office?.name?.trim() || null,
    logoUrl: office?.logoUrl ?? null,
    license: license?.number ?? null,
    phone: office?.phone ?? null,
  };
}
