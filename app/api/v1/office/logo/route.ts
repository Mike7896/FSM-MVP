import { randomUUID } from "node:crypto";

import { eq } from "drizzle-orm";

import { requireCaller, requireOrg } from "@/lib/api/auth";
import { handler, readJson } from "@/lib/api/handler";
import { ApiError, ok } from "@/lib/api/response";
import { BILLING_ROLES } from "@/lib/dal";
import { db } from "@/lib/db";
import { organizations } from "@/lib/db/schema";
import { logoUploadSchema, setLogoSchema } from "@/lib/schemas";
import {
  BUCKETS,
  createSignedUploadUrl,
  getPublicUrl,
  removeObjects,
} from "@/lib/supabase/storage";

/**
 * `/api/v1/office/logo` — putting the business's logo on its documents.
 *
 * Two calls, the same shape as a job photo: `POST` hands back somewhere to put
 * the file, the browser uploads straight to Storage, then `PUT` makes the file
 * that landed the Office's logo. The row is written after the bytes land, so a
 * logo that failed to upload is never the one on a customer's quote. `DELETE`
 * takes it off.
 *
 * A replaced or removed logo's file is deleted from the bucket once the row no
 * longer points at it.
 *
 * **The path is built here** from the organization `requireOrg` proved, and
 * `PUT` refuses any path outside it — the bucket is public, and a path from the
 * client could name another business's folder.
 */

export const POST = handler(async (request) => {
  const caller = await requireCaller(request);
  const { organizationId } = await requireOrg(request, caller, {
    roles: BILLING_ROLES,
  });
  const { fileName } = await readJson(request, logoUploadSchema);

  const extension = fileName.split(".").pop()!.toLowerCase();
  const path = `${organizationId}/logo-${randomUUID()}.${extension}`;
  const signed = await createSignedUploadUrl(BUCKETS.logos, path);

  return ok({ path: signed.path, signedUrl: signed.signedUrl });
});

export const PUT = handler(async (request) => {
  const caller = await requireCaller(request);
  const { organizationId } = await requireOrg(request, caller, {
    roles: BILLING_ROLES,
  });
  const { path } = await readJson(request, setLogoSchema);

  if (!path.startsWith(`${organizationId}/logo-`) || path.includes("..")) {
    throw new ApiError("forbidden", "That file isn't this Office's logo.");
  }

  const logoUrl = await getPublicUrl(BUCKETS.logos, path);
  const previous = await currentLogoPath(organizationId);

  const [row] = await db
    .update(organizations)
    .set({ logoUrl, updatedAt: new Date() })
    .where(eq(organizations.id, organizationId))
    .returning({ logoUrl: organizations.logoUrl });

  if (previous && previous !== path) await removeQuietly(previous);

  return ok(row);
});

export const DELETE = handler(async (request) => {
  const caller = await requireCaller(request);
  const { organizationId } = await requireOrg(request, caller, {
    roles: BILLING_ROLES,
  });
  const previous = await currentLogoPath(organizationId);

  const [row] = await db
    .update(organizations)
    .set({ logoUrl: null, updatedAt: new Date() })
    .where(eq(organizations.id, organizationId))
    .returning({ logoUrl: organizations.logoUrl });

  if (previous) await removeQuietly(previous);

  return ok(row);
});

/**
 * The bucket path of the Office's current logo, when it is a file we hold —
 * an older pasted link points somewhere else and there is nothing to delete.
 */
async function currentLogoPath(organizationId: string): Promise<string | null> {
  const [org] = await db
    .select({ logoUrl: organizations.logoUrl })
    .from(organizations)
    .where(eq(organizations.id, organizationId))
    .limit(1);

  const marker = `/storage/v1/object/public/${BUCKETS.logos}/`;
  const at = org?.logoUrl?.indexOf(marker) ?? -1;
  if (!org?.logoUrl || at === -1) return null;

  const path = decodeURIComponent(org.logoUrl.slice(at + marker.length));
  return path.startsWith(`${organizationId}/logo-`) && !path.includes("..")
    ? path
    : null;
}

/** An orphaned file costs a few kilobytes; a failed save over it costs the logo. */
async function removeQuietly(path: string) {
  await removeObjects(BUCKETS.logos, [path]).catch(() => undefined);
}
