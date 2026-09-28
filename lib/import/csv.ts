/**
 * Reading a CSV somebody else wrote.
 *
 * **The file is not ours, so nothing about it can be assumed.** It came out of
 * Excel, Numbers, Google Sheets or a competitor's export, which means: a
 * byte-order mark on the front, CRLF or LF or both, quoted fields containing
 * commas and newlines, doubled quotes inside quoted fields, and a ragged last
 * row. All of that is ordinary, and a parser that treats any of it as an error
 * rejects a contractor's real customer list.
 *
 * What is *not* handled, deliberately: semicolon and tab delimiters. They are a
 * European-locale export and a different problem, and guessing wrong silently
 * turns every row into one column — better to say so than to import nonsense.
 */

/**
 * As many rows as one import may carry.
 *
 * Big enough for any one-truck shop's history, small enough that the review
 * step is a page somebody actually reads rather than a wall they scroll past.
 * Lives here rather than beside the customer import so the schemas can hold the
 * same number without pulling in a server-only module.
 */
export const MAX_IMPORT_ROWS = 2000;

/** A file that parsed into rows of raw text. Nothing is interpreted here. */
export function parseCsv(input: string): string[][] {
  const text = input.replace(/^﻿/, "");
  const rows: string[][] = [];

  let row: string[] = [];
  let field = "";
  let quoted = false;
  let started = false;

  const endField = () => {
    row.push(field);
    field = "";
    started = false;
  };

  const endRow = () => {
    endField();
    // A trailing newline is not an empty last row, and neither is a line of
    // nothing but commas left behind by a spreadsheet.
    if (row.some((value) => value.trim() !== "")) rows.push(row);
    row = [];
  };

  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];

    if (quoted) {
      if (char === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 1;
        } else {
          quoted = false;
        }
      } else {
        field += char;
      }
      continue;
    }

    if (char === '"' && !started) {
      quoted = true;
      started = true;
      continue;
    }

    if (char === ",") {
      endField();
      continue;
    }

    if (char === "\r") {
      // CRLF or a lone CR; either way the row is over.
      if (text[i + 1] === "\n") i += 1;
      endRow();
      continue;
    }

    if (char === "\n") {
      endRow();
      continue;
    }

    field += char;
    started = true;
  }

  // Whatever is left when the file ends is the last row.
  if (field !== "" || row.length > 0) endRow();

  return rows;
}

/**
 * Matching a spreadsheet's headings to fields we know.
 *
 * **Headings are matched loosely on purpose.** "Customer", "Client name",
 * "CUSTOMER_NAME" and "name" are all the same column to the person who typed
 * them, and asking a contractor to rename columns before the product will read
 * their file is the kind of friction that ends the trial.
 */
export function normalizeHeading(value: string): string {
  return value
    .toLowerCase()
    .replace(/[\s_\-.]+/g, " ")
    .replace(/[^a-z0-9 ]/g, "")
    .trim();
}

export type FieldSpec<Field extends string> = {
  field: Field;
  label: string;
  /** Normalized headings that mean this field. First one is the export's own. */
  aliases: string[];
  required?: boolean;
};

export type ColumnMatch<Field extends string> = {
  /** Which column in the file, by index, or null when it isn't there. */
  found: Partial<Record<Field, { index: number; heading: string }>>;
  /** Headings in the file that matched nothing. Shown, never guessed at. */
  ignored: string[];
  /** Required fields with no column. Nothing can be imported without them. */
  missing: Field[];
};

export function matchColumns<Field extends string>(
  headings: string[],
  specs: FieldSpec<Field>[]
): ColumnMatch<Field> {
  const normalized = headings.map(normalizeHeading);
  const found: ColumnMatch<Field>["found"] = {};
  const claimed = new Set<number>();

  for (const spec of specs) {
    const index = normalized.findIndex(
      (heading, at) =>
        !claimed.has(at) && heading !== "" && spec.aliases.includes(heading)
    );
    if (index !== -1) {
      claimed.add(index);
      found[spec.field] = { index, heading: headings[index] };
    }
  }

  return {
    found,
    ignored: headings.filter(
      (heading, at) => !claimed.has(at) && heading.trim() !== ""
    ),
    missing: specs
      .filter((spec) => spec.required && !found[spec.field])
      .map((spec) => spec.field),
  };
}
