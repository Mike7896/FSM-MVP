import "server-only";

import { eq } from "drizzle-orm";

import { db } from "@/lib/db";
import { lookOf } from "@/lib/branding";
import {
  customers,
  jobs,
  licenses,
  officeDefaults,
  organizations,
  type HeaderSnapshot,
} from "@/lib/db/schema";

import { readAccess } from "@/lib/membership/access";

import type { Executor } from "./repository";

/**
 * The letterhead, frozen at send — Documents §2 and §12, item 4.
 *
 * Business name, license number, shop address and customer contact are read
 * from the Office, the License, the Customer and the Job **at the moment the
 * document goes out** and written onto it. A quote sent in March must still
 * show March's address after the shop moves in June; a live join would quietly
 * rewrite a document that is a legal record and dispute evidence.
 *
 * Before a document is sent there is nothing to freeze, so drafts read the
 * Office live — that is what lets the letterhead fill in on the preview while
 * he types his business name.
 *
 * **The plan is frozen too** (Billing §2.2): the logo goes on only for a shop
 * whose plan includes branding at the moment of sending, and only if the
 * Office's look includes it — the band the same — and a Free shop's
 * document carries the ServiceClerk footer. A later upgrade or downgrade
 * never restyles a document already in someone's hands.
 */
export async function captureHeader(
  input: {
    organizationId: string;
    jobId: string;
    customerId: string | null;
    licenseId: string | null;
  },
  on: Executor = db
): Promise<HeaderSnapshot> {
  const { features } = await readAccess(input.organizationId);

  const [office] = await on
    .select({
      name: organizations.name,
      phone: organizations.phone,
      email: organizations.email,
      address: organizations.address,
      logoUrl: organizations.logoUrl,
    })
    .from(organizations)
    .where(eq(organizations.id, input.organizationId))
    .limit(1);

  const [defaults] = await on
    .select({ preset: officeDefaults.documentPreset })
    .from(officeDefaults)
    .where(eq(officeDefaults.organizationId, input.organizationId))
    .limit(1);
  const look = lookOf(defaults?.preset);

  const [job] = await on
    .select({ address: jobs.address, number: jobs.number })
    .from(jobs)
    .where(eq(jobs.id, input.jobId))
    .limit(1);

  const [customer] = input.customerId
    ? await on
        .select({
          name: customers.name,
          email: customers.email,
          phone: customers.phone,
          address: customers.address,
        })
        .from(customers)
        .where(eq(customers.id, input.customerId))
        .limit(1)
    : [];

  const [license] = input.licenseId
    ? await on
        .select({ number: licenses.number, kind: licenses.class })
        .from(licenses)
        .where(eq(licenses.id, input.licenseId))
        .limit(1)
    : [];

  return {
    businessName: office?.name?.trim() || undefined,
    businessPhone: office?.phone ?? undefined,
    businessEmail: office?.email ?? undefined,
    businessAddress: office?.address ?? undefined,
    logoUrl: features.branding && look.logo ? (office?.logoUrl ?? undefined) : undefined,
    boldHeader: features.branding && look.bold,
    promoFooter: features.promoFooter,
    licenseNumber: license?.number ?? undefined,
    licenseKind: license?.kind ?? undefined,
    customerName: customer?.name ?? undefined,
    customerEmail: customer?.email ?? undefined,
    customerPhone: customer?.phone ?? undefined,
    customerAddress: customer?.address ?? undefined,
    jobAddress: job?.address ?? undefined,
    jobNumber: job?.number ?? undefined,
    capturedAt: new Date().toISOString(),
  };
}

/** Whether a document's header has been frozen yet. */
export function headerCaptured(header: HeaderSnapshot | null | undefined) {
  return Boolean(header?.capturedAt);
}
