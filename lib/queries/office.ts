import "server-only";

import { cache } from "react";
import { and, asc, desc, eq, isNotNull, isNull, sql } from "drizzle-orm";

import { db } from "@/lib/db";
import {
  jobs,
  licenses,
  officeDefaults,
  organizations,
  packEnablement,
  packEntitlements,
  prices,
  type HeaderSnapshot,
} from "@/lib/db/schema";
import { PACKS, type Pack } from "@/lib/packs/catalog";
import type { OfficeSignature } from "@/lib/signing/lines";

/**
 * The Office, read — Object Model §5.1.
 *
 * **Everything here is a read.** The Office's objects *supply* data to a Job's
 * documents and are never edited from one — a Preset supplies the five
 * decisions to a Quote, a License stamps a document and authorizes a Permit, a
 * pack supplies templates and taxonomy. That one-directional rule is what keeps
 * the Office from becoming a junk drawer and the Job hub from becoming a
 * settings screen, and it is why the quote editor has no path that writes back
 * into this file's tables.
 *
 * Every function takes an `organizationId` the caller has already proved.
 * Drizzle connects as a role that bypasses RLS, so an id arriving from a client
 * is an assertion until `requireActiveOrganization` or `requireOrg` has checked
 * it against a membership row.
 */

/**
 * What goes at the top of every document the customer reads.
 *
 * A missing value comes back as `null` rather than as a placeholder string. The
 * projection renders the gap visibly, which is what makes asking for it
 * persuasive at the moment it matters: the customer is about to read this.
 */
export type OfficeIdentity = {
  businessName: string | null;
  license: string | null;
  phone: string | null;
  /** A public image URL. Null until one is uploaded. */
  logoUrl?: string | null;
  /**
   * The adopted signature, on the screens that draw signature lines. Left
   * out everywhere else — see `getOfficeSignature`.
   */
  signature?: OfficeSignature | null;
};

export const getOfficeIdentity = cache(
  async (organizationId: string): Promise<OfficeIdentity> => {
    const [org] = await db
      .select({
        name: organizations.name,
        phone: organizations.phone,
        logoUrl: organizations.logoUrl,
      })
      .from(organizations)
      .where(eq(organizations.id, organizationId))
      .limit(1);

    // The active license, oldest first — a business with several holds its
    // primary one longest, and jurisdiction matching happens per document
    // rather than here. Picking one is a document-time decision the editor will own once
    // license selection lands; this is the default it starts from.
    const [license] = await db
      .select({ number: licenses.number })
      .from(licenses)
      .where(
        and(
          eq(licenses.organizationId, organizationId),
          eq(licenses.status, "active")
        )
      )
      .orderBy(asc(licenses.createdAt))
      .limit(1);

    return {
      // An Office made by skipping ahead has no name yet, and that is a gap to
      // draw rather than an empty string to print.
      businessName: org?.name?.trim() || null,
      license: license?.number ?? null,
      phone: org?.phone ?? null,
      logoUrl: org?.logoUrl ?? null,
    };
  }
);

/** The letterhead a document captured when it went out, as the page draws it. */
export function officeFromHeader(header: HeaderSnapshot): OfficeIdentity {
  return {
    businessName: header.businessName ?? null,
    license: header.licenseNumber ?? null,
    phone: header.businessPhone ?? null,
    logoUrl: header.logoUrl ?? null,
  };
}

/**
 * The Office as it stands today, under the license a document named — the
 * fallback for a document that never captured a letterhead of its own.
 */
export async function officeAsItStands(
  organizationId: string,
  licenseId: string | null
): Promise<OfficeIdentity> {
  const [org] = await db
    .select({
      name: organizations.name,
      phone: organizations.phone,
      logoUrl: organizations.logoUrl,
    })
    .from(organizations)
    .where(eq(organizations.id, organizationId))
    .limit(1);

  const [license] = licenseId
    ? await db
        .select({ number: licenses.number })
        .from(licenses)
        .where(eq(licenses.id, licenseId))
        .limit(1)
    : [];

  return {
    businessName: org?.name?.trim() || null,
    license: license?.number ?? null,
    phone: org?.phone ?? null,
    logoUrl: org?.logoUrl ?? null,
  };
}

/**
 * The business's adopted signature — Documents §5.
 *
 * Read on its own rather than folded into `getOfficeIdentity`, which half the
 * app reads for a name and a logo: only the screens that draw signature lines
 * need it. Null when nothing has been adopted.
 */
export const getOfficeSignature = cache(
  async (organizationId: string): Promise<OfficeSignature | null> => {
    const [row] = await db
      .select({
        printedName: officeDefaults.signatureName,
        mark: officeDefaults.signatureMark,
        autoSign: officeDefaults.autoSignContracts,
      })
      .from(officeDefaults)
      .where(eq(officeDefaults.organizationId, organizationId))
      .limit(1);

    if (!row?.mark || !row.printedName) return null;
    return {
      printedName: row.printedName,
      mark: row.mark,
      autoSign: row.autoSign,
    };
  }
);

/* ── Identity ─────────────────────────────────────────────────────────── */

/**
 * The Office's own attributes, whole — what `/office` edits.
 *
 * Named `Office` rather than `Profile`: *profile* belongs to the person and
 * lives in Account (Content Design §8). This is the business.
 */
export type Office = {
  id: string;
  name: string;
  slug: string;
  phone: string | null;
  email: string | null;
  address: string | null;
  website: string | null;
  logoUrl: string | null;
};

export const getOffice = cache(
  async (organizationId: string): Promise<Office | null> => {
    const [row] = await db
      .select({
        id: organizations.id,
        name: organizations.name,
        slug: organizations.slug,
        phone: organizations.phone,
        email: organizations.email,
        address: organizations.address,
        website: organizations.website,
        logoUrl: organizations.logoUrl,
      })
      .from(organizations)
      .where(eq(organizations.id, organizationId))
      .limit(1);

    return row ?? null;
  }
);

/* ── Licenses ─────────────────────────────────────────────────────────── */

/**
 * Every credential the Office holds, soonest to expire first.
 *
 * Expiry order rather than alphabetical, because the only reason to open this
 * page unprompted is a renewal and the one that matters is the next one.
 *
 * `state` is **derived here rather than read from the column**. The stored
 * status is what someone last wrote down; this is what the calendar says today,
 * and the calendar is the thing that actually revokes a license.
 */
export const listLicenses = cache(async (organizationId: string) => {
  const rows = await db
    .select({
      license: licenses,
      // How many documents already carry this number. It is what turns the
      // vault from a list into a record: an expired license with fourteen
      // quotes behind it is not a row to delete, it is history somebody may
      // have to answer questions about.
      usedOnQuotes: sql<string>`(
        select count(*) from quote_details qd
        where qd.license_id = ${sql.raw('"licenses"."id"')}
      )`,
    })
    .from(licenses)
    .where(eq(licenses.organizationId, organizationId))
    .orderBy(asc(licenses.expiresOn), asc(licenses.jurisdiction));

  const today = Date.now();

  return rows.map(({ license: row, usedOnQuotes }) => {
    const daysToExpiry = row.expiresOn
      ? Math.round((new Date(row.expiresOn).getTime() - today) / 86_400_000)
      : null;

    return {
      ...row,
      usedOnQuotes: Number(usedOnQuotes),
      daysToExpiry,
      state:
        daysToExpiry === null
          ? ("unknown" as const)
          : daysToExpiry < 0
            ? ("expired" as const)
            : daysToExpiry <= (row.renewalReminderDays ?? 60)
              ? ("expiring" as const)
              : ("active" as const),
    };
  });
});

export type LicenseRow = Awaited<ReturnType<typeof listLicenses>>[number];

/**
 * Jurisdictions the business is working in and holds no license for.
 *
 * **The gap is worth more than the match.** Telling a contractor he has no
 * license for the town he is about to quote beats attaching one correctly, and
 * it is the case that justifies the whole License Manager. It is computed from
 * the jobs that actually exist rather than asserted, so it appears when the
 * work does and disappears on its own the moment a license is added.
 *
 * A missing local license has two consequences and only one of them is
 * cosmetic: a wrong number on a document, and — since a Permit is authorized by
 * a jurisdiction-valid License — a job that cannot legally start.
 */
export const listLicenseGaps = cache(async (organizationId: string) => {
  const rows = await db
    .select({
      jurisdiction: jobs.jurisdiction,
      jobCount: sql<string>`count(*)`,
    })
    .from(jobs)
    .where(
      and(
        eq(jobs.organizationId, organizationId),
        isNotNull(jobs.jurisdiction),
        // Case-insensitive: "Lower Merion Township" typed on a job and "lower
        // merion township" typed on a license are the same place, and a warning
        // that fires on capitalisation is a warning that gets ignored.
        sql`not exists (
          select 1 from ${licenses} l
          where l.organization_id = ${organizationId}
            and lower(l.jurisdiction) = lower(${jobs.jurisdiction})
        )`
      )
    )
    .groupBy(jobs.jurisdiction)
    .orderBy(desc(sql`count(*)`));

  return rows.map((row) => ({
    jurisdiction: row.jurisdiction!,
    jobCount: Number(row.jobCount),
  }));
});

/* ── Defaults ─────────────────────────────────────────────────────────── */

/**
 * The Office's defaults, with the row created on first read.
 *
 * Creating it here rather than at signup means an account that existed before
 * this table did still has defaults the first time anyone looks, and there is
 * one code path instead of two. Every column is nullable, so the row created is
 * genuinely empty — *we have no opinion yet* — rather than a set of numbers
 * nobody chose. A business that has not set a tax rate is not one with a 0% tax
 * rate, and the editor has to be able to tell those apart.
 */
export const getOfficeDefaults = cache(async (organizationId: string) => {
  const [existing] = await db
    .select()
    .from(officeDefaults)
    .where(eq(officeDefaults.organizationId, organizationId))
    .limit(1);

  if (existing) return existing;

  const [created] = await db
    .insert(officeDefaults)
    .values({ organizationId })
    .onConflictDoNothing()
    .returning();

  // A concurrent first read won the insert. Read it back rather than returning
  // a synthesised row, so the caller always holds what is actually stored.
  if (created) return created;

  const [raced] = await db
    .select()
    .from(officeDefaults)
    .where(eq(officeDefaults.organizationId, organizationId))
    .limit(1);

  return raced;
});

export type OfficeDefaultsRow = Awaited<
  ReturnType<typeof getOfficeDefaults>
>;

/* ── Trade packs ──────────────────────────────────────────────────────── */

export type PackState = {
  pack: Pack;
  /** Paid for. */
  entitled: boolean;
  /** Switched on. Owning a pack and running one are different states. */
  enabled: boolean;
  /** What Stripe charges for it, in cents. Null when it is not sellable yet. */
  priceCents: number | null;
};

/**
 * The catalogue, with this Office's entitlement and enablement folded in.
 *
 * **Entitlement and enablement are separate axes**, so owned-but-off is a
 * visible state that explains itself rather than a mystery that invites a
 * second purchase. A revoked entitlement is not an entitlement — the column is
 * a timestamp rather than a boolean so a lapse keeps its date.
 *
 * The price comes from the Stripe read-model by lookup key. A pack with no
 * matching active price comes back with `priceCents: null`, and the surface
 * says the price is not set rather than showing a number we invented.
 */
export const listPacks = cache(
  async (organizationId: string): Promise<PackState[]> => {
    const [entitlements, enablement, priceRows] = await Promise.all([
      db
        .select({ packId: packEntitlements.packId })
        .from(packEntitlements)
        .where(
          and(
            eq(packEntitlements.organizationId, organizationId),
            isNull(packEntitlements.revokedAt)
          )
        ),
      db
        .select({
          packId: packEnablement.packId,
          enabled: packEnablement.enabled,
        })
        .from(packEnablement)
        .where(eq(packEnablement.organizationId, organizationId)),
      db
        .select({ id: prices.id, unitAmount: prices.unitAmount })
        .from(prices)
        .where(eq(prices.active, true)),
    ]);

    const entitled = new Set(entitlements.map((row) => row.packId));
    const enabled = new Map(enablement.map((row) => [row.packId, row.enabled]));
    const priceFor = new Map(priceRows.map((row) => [row.id, row.unitAmount]));

    return PACKS.map((pack) => ({
      pack,
      entitled: entitled.has(pack.id),
      // Enablement defaults to on for an entitled pack with no row yet: paying
      // for a trade and then having to switch it on is a step nobody wants.
      enabled: entitled.has(pack.id) && (enabled.get(pack.id) ?? true),
      priceCents: pack.stripePriceLookupKey
        ? (priceFor.get(pack.stripePriceLookupKey) ?? null)
        : null,
    }));
  }
);

/** The packs this Office is actually running — what the editor's frame reads. */
export const listEnabledPacks = cache(async (organizationId: string) => {
  const states = await listPacks(organizationId);
  return states.filter((state) => state.enabled).map((state) => state.pack);
});
