import "server-only";

import { and, eq, inArray, sql } from "drizzle-orm";

import { db } from "@/lib/db";
import { customers } from "@/lib/db/schema";

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

export type CustomerField = "name" | "email" | "phone" | "address" | "notes";

const FIELDS: FieldSpec<CustomerField>[] = [
  {
    field: "name",
    label: "Customer",
    required: true,
    aliases: [
      "customer",
      "customer name",
      "name",
      "client",
      "client name",
      "full name",
      "contact",
      "contact name",
    ],
  },
  {
    field: "email",
    label: "Email",
    aliases: ["email", "email address", "e mail", "mail"],
  },
  {
    field: "phone",
    label: "Phone",
    aliases: ["phone", "phone number", "telephone", "mobile", "cell", "cell phone"],
  },
  {
    field: "address",
    label: "Address",
    aliases: ["address", "street address", "billing address", "mailing address"],
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
  name: string;
  email: string | null;
  phone: string | null;
  address: string | null;
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

  if (match.missing.length > 0) {
    return {
      ...empty,
      ignored: match.ignored,
      problem:
        "This file needs a column for the customer's name. " +
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

  const parsed = body.map((row, index) => ({
    line: index + 2,
    name: value(row, "name", 160) ?? "",
    email: value(row, "email", 160),
    phone: value(row, "phone", 40),
    address: value(row, "address", 300),
    notes: value(row, "notes", 2000),
  }));

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
  rows: {
    name: string;
    email?: string | null;
    phone?: string | null;
    address?: string | null;
    notes?: string | null;
  }[]
): Promise<{ created: number }> {
  if (rows.length === 0) return { created: 0 };

  const written = await db
    .insert(customers)
    .values(
      rows.map((row) => ({
        organizationId,
        name: row.name,
        email: row.email ?? null,
        phone: row.phone ?? null,
        address: row.address ?? null,
        notes: row.notes ?? null,
      }))
    )
    .returning({ id: customers.id });

  return { created: written.length };
}
