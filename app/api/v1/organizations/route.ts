import { randomBytes } from "node:crypto";

import { eq } from "drizzle-orm";
import { requireCaller } from "@/lib/api/auth";
import { handler, readJson } from "@/lib/api/handler";
import { ApiError, created, ok } from "@/lib/api/response";
import { db } from "@/lib/db";
import { memberships, organizations, profiles } from "@/lib/db/schema";
import { createOrganizationSchema } from "@/lib/schemas";

/**
 * `/api/v1/organizations` — the Office itself.
 *
 * The one domain endpoint that does not go through `requireOrg`, for the
 * obvious reason: this is where the first organization comes from, so there is
 * nothing to scope to yet.
 *
 * **One Office per person, for now.** The app resolves a person's first
 * membership everywhere, so a second Office would be one he could never reach —
 * asking for another when one exists is a 409 that names it, which is also what
 * a double-tap on the letterhead's Save produces.
 *
 * **The name is optional.** A contractor who skips straight to the dashboard
 * still needs an Office for his work to live in, and the name is asked for at
 * the letterhead, where it shows.
 */

export const GET = handler(async (request) => {
  const caller = await requireCaller(request);

  const rows = await db
    .select({
      id: organizations.id,
      name: organizations.name,
      slug: organizations.slug,
      phone: organizations.phone,
      email: organizations.email,
      role: memberships.role,
      createdAt: organizations.createdAt,
    })
    .from(memberships)
    .innerJoin(organizations, eq(memberships.organizationId, organizations.id))
    .where(eq(memberships.userId, caller.userId));

  return ok(rows);
});

export const POST = handler(async (request) => {
  const caller = await requireCaller(request);
  const body = await readJson(request, createOrganizationSchema);

  const [existing] = await db
    .select({ id: memberships.organizationId })
    .from(memberships)
    .where(eq(memberships.userId, caller.userId))
    .limit(1);

  if (existing) {
    throw new ApiError("conflict", "You already have an Office.", {
      organizationId: existing.id,
    });
  }

  const name = body.name?.trim() ?? "";
  const slug = await freeSlug(body.slug ?? slugify(name), Boolean(body.slug));

  // The trade may have been answered before the Office existed.
  const [profile] = await db
    .select({ trade: profiles.trade })
    .from(profiles)
    .where(eq(profiles.id, caller.userId))
    .limit(1);

  // Creating the Office and joining it are one act — an organization with no
  // owner is unreachable, so a partial failure here would strand a row.
  const organization = await db.transaction(async (tx) => {
    const [row] = await tx
      .insert(organizations)
      .values({
        name,
        slug,
        phone: body.phone,
        email: body.email ?? caller.email,
        trade: profile?.trade ?? null,
        createdBy: caller.userId,
      })
      .returning();

    await tx.insert(memberships).values({
      organizationId: row.id,
      userId: caller.userId,
      role: "owner",
    });

    return row;
  });

  return created(organization, `/api/v1/organizations/${organization.id}`);
});

function slugify(name: string) {
  return (
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 60) || "office"
  );
}

/**
 * A handle nobody else holds. A slug the caller chose is theirs or a conflict;
 * one generated from a name gets a short suffix instead, because two businesses
 * called the same thing is ordinary and not something to refuse.
 */
async function freeSlug(base: string, chosen: boolean): Promise<string> {
  for (let attempt = 0; attempt < 6; attempt++) {
    const candidate =
      attempt === 0 ? base : `${base.slice(0, 53)}-${randomBytes(3).toString("hex")}`;

    const [taken] = await db
      .select({ id: organizations.id })
      .from(organizations)
      .where(eq(organizations.slug, candidate))
      .limit(1);

    if (!taken) return candidate;
    if (chosen) {
      throw new ApiError("conflict", `The handle "${candidate}" is already taken.`);
    }
  }

  throw new ApiError("conflict", "Couldn't find a free handle. Try again.");
}
