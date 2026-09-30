import "server-only";

import { cache } from "react";
import { notFound, redirect } from "next/navigation";
import type { NextRequest } from "next/server";
import { eq } from "drizzle-orm";

import { requireCaller, type ApiCaller } from "@/lib/api/auth";
import { ApiError } from "@/lib/api/response";
import { verifySession } from "@/lib/dal";
import { db } from "@/lib/db";
import { platformAdmins } from "@/lib/db/schema";

import { isOwnerEmail, type Admin } from "./owners";

export { isOwnerEmail, ownerEmails, type Admin } from "./owners";

/**
 * Who may use the admin panel.
 *
 * **Owners and admins.** The owners are named in `ADMIN_EMAILS` — set on the
 * deploy, always admins, and never removable from the panel, so nobody can
 * lock the people who run the product out of it. Anyone else is an admin
 * because an owner or admin added them in Accounts, which puts them in
 * `platform_admins`; that table is also what RLS (and so the live feed) checks.
 *
 * **Anyone else gets a 404**, not a 403: the panel doesn't admit to existing
 * to someone who can't open it.
 */

async function adminFor(userId: string, email: string): Promise<Admin | null> {
  if (isOwnerEmail(email)) {
    // An owner is always in the table, so Realtime lets them in too.
    await db
      .insert(platformAdmins)
      .values({ userId, email: email.toLowerCase(), note: "Owner (ADMIN_EMAILS)" })
      .onConflictDoUpdate({ target: platformAdmins.userId, set: { email: email.toLowerCase() } });
    return { userId, email, owner: true };
  }
  const [row] = await db
    .select({ userId: platformAdmins.userId })
    .from(platformAdmins)
    .where(eq(platformAdmins.userId, userId))
    .limit(1);
  return row ? { userId, email, owner: false } : null;
}

/** Optional admin access for navigation; regular users stay in the app. */
export const getCurrentAdmin = cache(async (): Promise<Admin | null> => {
  const session = await verifySession();
  return session ? adminFor(session.userId, session.email) : null;
});

/**
 * For the panel's pages: the admin, or a 404. Cached per request, so the
 * layout and the page share one check instead of racing two on the one dev
 * database connection.
 */
export const requireAdmin = cache(async (): Promise<Admin> => {
  const session = await verifySession();
  if (!session) redirect("/login?next=/admin");
  const admin = await adminFor(session.userId, session.email);
  if (!admin) notFound();
  return admin;
});

/** For the panel's API: the admin, or "not found". */
export async function requireAdminCaller(request: NextRequest): Promise<ApiCaller & { owner: boolean }> {
  const caller = await requireCaller(request);
  const admin = await adminFor(caller.userId, caller.email);
  if (!admin) throw new ApiError("not_found", "Not found.");
  return { ...caller, owner: admin.owner };
}
