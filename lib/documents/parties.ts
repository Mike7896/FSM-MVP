import type { HeaderSnapshot } from "@/lib/db/schema";

/**
 * Who a document is between, as the paper prints it.
 *
 * **Customer-facing fields only.** A document is emailed, forwarded and
 * printed, so what goes on it is what a quote or an invoice normally carries:
 * the customer's name and company, how to reach them, and where bills go. The
 * second phone and email, the preferred way to reach them, how they found the
 * shop, the property access notes and the notes log stay in the office — a
 * gate code on a PDF in somebody's inbox is a gate code anyone can read.
 *
 * Kept free of server imports: the editor's preview, the share page, the PDF
 * and the email all draw from it.
 */

export type DocumentCustomer = {
  name: string | null;
  company: string | null;
  phone: string | null;
  email: string | null;
  /** Where bills go: their billing address when they have one, else their own. */
  billingAddress: string | null;
};

/** A dated line beside the number — "Date", "Valid until", "Due". */
export type DocumentFact = { label: string; value: string };

export const NO_CUSTOMER: DocumentCustomer = {
  name: null,
  company: null,
  phone: null,
  email: null,
  billingAddress: null,
};

/** The customer a document froze when it went out — Documents §2. */
export function customerFromHeader(
  header: HeaderSnapshot | null | undefined
): DocumentCustomer {
  if (!header) return NO_CUSTOMER;
  return {
    name: header.customerName ?? null,
    company: header.customerCompany ?? null,
    phone: header.customerPhone ?? null,
    email: header.customerEmail ?? null,
    billingAddress: header.customerBillingAddress ?? header.customerAddress ?? null,
  };
}

/** The customer as they stand on their record — for a draft, before anything is frozen. */
export function customerFromRecord(row: {
  name: string | null;
  companyName: string | null;
  phone: string | null;
  email: string | null;
  address: string | null;
  billingAddress: string | null;
}): DocumentCustomer {
  return {
    name: row.name,
    // A company-only customer's name already is the company.
    company: row.companyName && row.companyName !== row.name ? row.companyName : null,
    phone: row.phone,
    email: row.email,
    billingAddress: row.billingAddress ?? row.address,
  };
}

/** Same street, ignoring case, commas and spacing. */
function sameAddress(a: string | null, b: string | null) {
  const norm = (value: string | null) =>
    (value ?? "").toLowerCase().replace(/[^a-z0-9]+/g, "");
  return Boolean(a && b) && norm(a) === norm(b);
}

/**
 * What prints under "Prepared for", in order, blanks left out.
 *
 * The billing address is printed only when it isn't the job site already
 * printed beside it — the same street twice reads as a mistake.
 */
export function customerLines(
  customer: DocumentCustomer,
  jobAddress: string | null
): { name: string | null; rest: string[] } {
  const address =
    customer.billingAddress && !sameAddress(customer.billingAddress, jobAddress)
      ? customer.billingAddress
      : null;
  return {
    name: customer.name?.trim() || null,
    rest: [customer.company, address, customer.phone, customer.email]
      .map((value) => value?.trim())
      .filter((value): value is string => Boolean(value)),
  };
}

/** The heading over the customer — an invoice is addressed, the rest are prepared. */
export function customerHeading(kind: "quote" | "contract" | "change_order" | "invoice") {
  return kind === "invoice" ? "Bill to" : "Prepared for";
}

/** "Oct 11, 2026" — a moment, as the paper dates it. */
export function documentDate(at: Date | string) {
  const date = typeof at === "string" ? new Date(at) : at;
  return date.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

/** "Nov 10, 2026" — a calendar date as stored (`YYYY-MM-DD`), read in its own day. */
export function calendarDate(iso: string) {
  return new Date(`${iso}T12:00:00Z`).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  });
}
