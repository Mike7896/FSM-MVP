import "server-only";

import { eq } from "drizzle-orm";

import { db } from "@/lib/db";
import { customers, jobs, type HeaderSnapshot } from "@/lib/db/schema";

import { headerCaptured } from "./header";
import {
  NO_CUSTOMER,
  customerFromHeader,
  customerFromRecord,
  documentDate,
  type DocumentCustomer,
  type DocumentFact,
} from "./parties";

/**
 * The customer a document prints: the one frozen into its letterhead when it
 * went out (Documents §2), else their record as it stands — a draft has frozen
 * nothing yet, and what it shows is what sending it would freeze.
 */
export async function documentCustomer(
  header: HeaderSnapshot | null | undefined,
  customerId: string | null
): Promise<DocumentCustomer> {
  if (header && headerCaptured(header)) return customerFromHeader(header);
  if (!customerId) return NO_CUSTOMER;
  return liveCustomer(customerId);
}

/** A customer's printable details, read from their record. */
export async function liveCustomer(customerId: string): Promise<DocumentCustomer> {
  const [row] = await db
    .select({
      name: customers.name,
      companyName: customers.companyName,
      phone: customers.phone,
      email: customers.email,
      address: customers.address,
      billingAddress: customers.billingAddress,
    })
    .from(customers)
    .where(eq(customers.id, customerId))
    .limit(1);
  return row ? customerFromRecord(row) : NO_CUSTOMER;
}

/** Where the work is: frozen with the letterhead, else the job's own. */
export async function documentJobAddress(
  header: HeaderSnapshot | null | undefined,
  jobId: string
): Promise<string | null> {
  if (header?.jobAddress) return header.jobAddress;
  const [job] = await db
    .select({ address: jobs.address })
    .from(jobs)
    .where(eq(jobs.id, jobId))
    .limit(1);
  return job?.address ?? null;
}

/** "Date" — when it went out, or today for paper drawn ahead of the send. */
export function issuedFact(at: Date | string | null | undefined): DocumentFact {
  return { label: "Date", value: documentDate(at ?? new Date()) };
}
