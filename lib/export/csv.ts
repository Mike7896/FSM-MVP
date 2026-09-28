/**
 * Rows to CSV, for a spreadsheet somebody else opens.
 *
 * **The file has to survive Excel.** Which means: CRLF line endings, every
 * field quoted where it could be misread, and a UTF-8 byte-order mark on the
 * front — without the BOM, Excel on Windows reads "Doña" as "DoÃ±a" and the
 * contractor's export looks broken through no fault of the data.
 *
 * **Money leaves as dollars, not cents.** The export is read by a bookkeeper,
 * not by this codebase: `1234.56` is a number they can sum, `123456` is a
 * number they would have to know to divide.
 */

export type CsvValue = string | number | boolean | Date | null | undefined;
export type CsvRow = Record<string, CsvValue>;

/** A single field, quoted where it has to be. */
function field(value: CsvValue): string {
  if (value === null || value === undefined) return "";

  const text =
    value instanceof Date
      ? value.toISOString()
      : typeof value === "boolean"
        ? value
          ? "yes"
          : "no"
        : String(value);

  // A leading =, +, - or @ is read as a formula by Excel and Sheets, which is
  // both a broken cell and the well-known CSV injection hole. Prefixing with a
  // single quote is what spreadsheets themselves use to mean "this is text".
  const safe = /^[=+\-@\t\r]/.test(text) ? `'${text}` : text;

  return `"${safe.replace(/"/g, '""')}"`;
}

/**
 * `columns` fixes the order and the headings; a row missing one exports empty
 * rather than shifting every later column left.
 */
export function toCsv(rows: CsvRow[], columns?: string[]): string {
  const headings =
    columns ?? [...new Set(rows.flatMap((row) => Object.keys(row)))];

  const lines = [
    headings.map(field).join(","),
    ...rows.map((row) => headings.map((key) => field(row[key])).join(",")),
  ];

  return `﻿${lines.join("\r\n")}\r\n`;
}

/** Integer cents as a plain decimal — no symbol, no thousands separator. */
export function dollars(cents: number | null | undefined): string | null {
  if (cents === null || cents === undefined) return null;
  const sign = cents < 0 ? "-" : "";
  const absolute = Math.abs(cents);
  return `${sign}${Math.floor(absolute / 100)}.${String(absolute % 100).padStart(2, "0")}`;
}

/** A timestamp as a date and time somebody can read, in the file's own tz. */
export function stamp(value: Date | string | null | undefined): string | null {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}
