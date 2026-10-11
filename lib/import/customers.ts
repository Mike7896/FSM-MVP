import "server-only";

import { and, eq, inArray, sql } from "drizzle-orm";

import { displayName, splitName } from "@/lib/customers/name";
import { db } from "@/lib/db";
import { customerNotes, customers } from "@/lib/db/schema";

import type { ImportCustomersInput } from "@/lib/schemas/import";

import { MAX_IMPORT_ROWS, matchColumns, parseCsv, type FieldSpec } from "./csv";

/**
 * Bringing a customer list in from a spreadsheet.
 *
 * **Nothing lands silently.** The file is read, every row is judged, and the
 * contractor sees what will happen to each one *before* anything is written —
 * which is the whole difference between an import they trust and one they have
 * to clean up afterwards.
 *
 * **Duplicates are surfaced, never merged.** A row matching somebody already in
 * the directory is marked and left out by default; the contractor can bring it
 * in anyway if the two really are different people with the same name. Merging
 * automatically would silently overwrite a phone number they fixed last week.
 *
 * **The file this product exports is a file this product reads.** Export,
 * edit in Excel, import back — the headings match, so the round trip works
 * without anybody mapping columns by hand.
 */

export type CustomerField =
  | "name"
  | "firstName"
  | "lastName"
  | "companyName"
  | "email"
  | "altEmail"
  | "phone"
  | "altPhone"
  | "preferredContact"
  | "address"
  | "billingAddress"
  | "accessNotes"
  | "leadSource"
  | "notes";

/**
 * A name can arrive whole, in parts, or as a company — whichever the file has.
 * None of the three is required on its own; a file with none of them is
 * refused in the preview.
 */
const FIELDS: FieldSpec<CustomerField>[] = [
  {
    field: "name",
    label: "Customer",
    aliases: [
      "customer",
      "customer name",
      "name",
      "client",
      "client name",
      "full name",
      "contact",
      "contact name",
      "display name",
    ],
  },
  {
    field: "firstName",
    label: "First name",
    aliases: ["first name", "first", "firstname", "given name"],
  },
  {
    field: "lastName",
    label: "Last name",
    aliases: ["last name", "last", "lastname", "surname", "family name"],
  },
  {
    field: "companyName",
    label: "Company",
    aliases: ["company", "company name", "business", "business name", "organization"],
  },
  {
    field: "email",
    label: "Email",
    aliases: ["email", "email address", "e mail", "mail", "primary email"],
  },
  {
    field: "altEmail",
    label: "Other email",
    aliases: ["other email", "alternate email", "secondary email", "email 2", "second email"],
  },
  {
    field: "phone",
    label: "Phone",
    aliases: [
      "phone",
      "phone number",
      "telephone",
      "mobile",
      "mobile phone",
      "cell",
      "cell phone",
      "primary phone",
      "main phone",
    ],
  },
  {
    field: "altPhone",
    label: "Other phone",
    aliases: [
      "other phone",
      "alternate phone",
      "secondary phone",
      "phone 2",
      "second phone",
      "home phone",
      "work phone",
    ],
  },
  {
    field: "preferredContact",
    label: "Preferred contact",
    aliases: ["preferred contact", "contact preference", "preferred contact method"],
  },
  {
    field: "address",
    label: "Service address",
    aliases: [
      "service address",
      "address",
      "street address",
      "property address",
      "job address",
      // Most other tools' one address column — for a homeowner, their home.
      "mailing address",
    ],
  },
  {
    field: "billingAddress",
    label: "Billing address",
    aliases: ["billing address", "bill to"],
  },
  {
    field: "accessNotes",
    label: "Property access",
    aliases: ["property access", "access notes", "access", "gate code", "property notes"],
  },
  {
    field: "leadSource",
    label: "Lead source",
    aliases: ["lead source", "source", "referral source", "referred by", "how did you hear"],
  },
  {
    field: "notes",
    label: "Notes",
    aliases: ["notes", "note", "comments", "description"],
  },
];

export type RowVerdict = "new" | "duplicate" | "invalid";

export type PreviewRow = {
  /** Line in the file, counting the heading row as 1 — what Excel shows. */
  line: number;
  /** The one line the directory will show — whole, or made from the parts. */
  name: string;
  firstName: string | null;
  lastName: string | null;
  companyName: string | null;
  email: string | null;
  altEmail: string | null;
  phone: string | null;
  altPhone: string | null;
  preferredContact: ContactMethod | null;
  address: string | null;
  billingAddress: string | null;
  accessNotes: string | null;
  leadSource: string | null;
  notes: string | null;
  verdict: RowVerdict;
  /** Why it can't come in, or who it already matches. */
  reason: string | null;
};

export type ImportPreview = {
  /** Which column in their file is being read as what. */
  columns: { field: CustomerField; label: string; heading: string }[];
  /** Headings we didn't recognise. Named so nothing looks lost. */
  ignored: string[];
  /** Set when the file can't be imported at all. */
  problem: string | null;
  rows: PreviewRow[];
  counts: Record<RowVerdict, number>;
};

const EMAIL = /^\S+@\S+\.\S+$/;

type ContactMethod = "call" | "text" | "email";

/** "Text", "SMS", "Phone" — what a spreadsheet says, to what the form stores. */
function contactMethod(value: string | null): ContactMethod | null {
  const word = value?.trim().toLowerCase();
  if (!word) return null;
  if (["call", "phone", "phone call", "calls"].includes(word)) return "call";
  if (["text", "sms", "texts", "text message"].includes(word)) return "text";
  if (["email", "e-mail", "mail"].includes(word)) return "email";
  return null;
}

function clean(value: string | undefined, max: number): string | null {
  const text = (value ?? "").trim();
  if (!text) return null;
  return text.length > max ? text.slice(0, max) : text;
}

/**
 * Reads the file and says what would happen. Writes nothing.
 */
export async function previewCustomerImport(
  organizationId: string,
  csv: string
): Promise<ImportPreview> {
  const empty = { counts: { new: 0, duplicate: 0, invalid: 0 }, rows: [], columns: [], ignored: [] };
  const table = parseCsv(csv);

  if (table.length === 0) {
    return { ...empty, problem: "That file is empty." };
  }

  const [headings, ...body] = table;
  const match = matchColumns(headings, FIELDS);

  const hasName =
    match.found.name ||
    match.found.firstName ||
    match.found.lastName ||
    match.found.companyName;

  if (!hasName) {
    return {
      ...empty,
      ignored: match.ignored,
      problem:
        "This file needs a column for the customer's name — a whole name, a first and last name, or a company. " +
        (match.ignored.length
          ? `The headings found were: ${match.ignored.join(", ")}.`
          : "No headings were found at all — the first row should name the columns."),
    };
  }

  if (body.length > MAX_IMPORT_ROWS) {
    return {
      ...empty,
      problem: `That file has ${body.length} rows. Bring in ${MAX_IMPORT_ROWS} at a time or fewer, so you can actually check them.`,
    };
  }

  const value = (row: string[], field: CustomerField, max: number) => {
    const column = match.found[field];
    return column ? clean(row[column.index], max) : null;
  };

  const parsed = body.map((row, index) => {
    const whole = value(row, "name", 160);
    let firstName = value(row, "firstName", 80);
    let lastName = value(row, "lastName", 80);
    const companyName = value(row, "companyName", 160);
    // Parts win when the file has them; a whole name alone is split.
    if (!firstName && !lastName && whole && whole !== companyName) {
      ({ firstName, lastName } = splitName(whole));
    }
    return {
      line: index + 2,
      name: displayName({ firstName, lastName, companyName }) ?? whole ?? "",
      firstName,
      lastName,
      companyName,
      email: value(row, "email", 160),
      altEmail: value(row, "altEmail", 160),
      phone: value(row, "phone", 40),
      altPhone: value(row, "altPhone", 40),
      preferredContact: contactMethod(value(row, "preferredContact", 40)),
      address: value(row, "address", 300),
      billingAddress: value(row, "billingAddress", 300),
      accessNotes: value(row, "accessNotes", 1000),
      leadSource: value(row, "leadSource", 80),
      notes: value(row, "notes", 2000),
    };
  });

  /* ── Who is already here ────────────────────────────────────────────── */

  const names = [...new Set(parsed.map((row) => row.name.toLowerCase()).filter(Boolean))];
  const existing = names.length
    ? await db
        .select({ name: customers.name, email: customers.email })
        .from(customers)
        .where(
          and(
            eq(customers.organizationId, organizationId),
            eq(customers.isDemo, false),
            inArray(sql`lower(${customers.name})`, names)
          )
        )
    : [];

  const already = new Map(
    existing.map((row) => [row.name.toLowerCase(), row] as const)
  );

  // Rows that repeat inside the file itself. The first one is the import; the
  // rest are duplicates of it, which is what the contractor means by them.
  const seen = new Set<string>();

  const rows: PreviewRow[] = parsed.map((row) => {
    const key = row.name.toLowerCase();

    let verdict: RowVerdict = "new";
    let reason: string | null = null;

    if (!row.name) {
      verdict = "invalid";
      reason = "No name in this row.";
    } else if (row.email && !EMAIL.test(row.email)) {
      verdict = "invalid";
      reason = `"${row.email}" isn't an email address.`;
    } else if (row.altEmail && !EMAIL.test(row.altEmail)) {
      verdict = "invalid";
      reason = `"${row.altEmail}" isn't an email address.`;
    } else if (already.has(key)) {
      const match = already.get(key)!;
      verdict = "duplicate";
      reason = match.email
        ? `Already in your customers, as ${match.name} (${match.email}).`
        : `Already in your customers, as ${match.name}.`;
    } else if (seen.has(key)) {
      verdict = "duplicate";
      reason = "This name is further up the same file.";
    }

    if (verdict === "new") seen.add(key);

    return { ...row, verdict, reason };
  });

  return {
    columns: FIELDS.filter((spec) => match.found[spec.field]).map((spec) => ({
      field: spec.field,
      label: spec.label,
      heading: match.found[spec.field]!.heading,
    })),
    ignored: match.ignored,
    problem: null,
    rows,
    counts: {
      new: rows.filter((row) => row.verdict === "new").length,
      duplicate: rows.filter((row) => row.verdict === "duplicate").length,
      invalid: rows.filter((row) => row.verdict === "invalid").length,
    },
  };
}

/**
 * Writes the rows the contractor confirmed, and nothing else.
 *
 * One transaction: an import that half-lands is worse than one that fails,
 * because the contractor cannot tell which half is missing.
 */
export async function commitCustomerImport(
  organizationId: string,
  rows: ImportCustomersInput["rows"]
): Promise<{ created: number }> {
  if (rows.length === 0) return { created: 0 };

  return db.transaction(async (tx) => {
    const written = await tx
      .insert(customers)
      .values(
        rows.map((row) => {
          const firstName = row.firstName ?? null;
          const lastName = row.lastName ?? null;
          const companyName = row.companyName ?? null;
          return {
            organizationId,
            name: displayName({ firstName, lastName, companyName }) ?? row.name,
            firstName,
            lastName,
            companyName,
            email: row.email ?? null,
            altEmail: row.altEmail ?? null,
            phone: row.phone ?? null,
            altPhone: row.altPhone ?? null,
            preferredContact: row.preferredContact ?? null,
            address: row.address ?? null,
            billingAddress: row.billingAddress ?? null,
            accessNotes: row.accessNotes ?? null,
            leadSource: row.leadSource ?? null,
          };
        })
      )
      .returning({ id: customers.id });

    // A Notes column becomes the first entry in each customer's log.
    const notes = written.flatMap((customer, index) => {
      const body = rows[index].notes?.trim();
      return body ? [{ organizationId, customerId: customer.id, body }] : [];
    });
    if (notes.length) await tx.insert(customerNotes).values(notes);

    return { created: written.length };
  });
}
