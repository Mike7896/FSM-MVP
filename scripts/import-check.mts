/**
 * Reading somebody else's spreadsheet, checked for real.
 *
 * The parser is the risky half of an import: a file it mangles quietly becomes
 * a customer directory full of wrong phone numbers, and nobody notices until
 * they call the wrong person. So the cases here are the ones real exports
 * actually contain — quoted commas, newlines inside a cell, doubled quotes, a
 * byte-order mark, CRLF, a ragged last row — plus the judgement calls the
 * review screen is built on.
 *
 *     npm run import:check
 */

import { sql } from "drizzle-orm";

import { db } from "@/lib/db";
// Concrete modules rather than the barrel: tsx loads the library as CJS.
import { parseCsv } from "@/lib/import/csv";
import {
  commitCustomerImport,
  previewCustomerImport,
} from "@/lib/import/customers";

let passed = 0;
const failures: string[] = [];

function check(label: string, condition: boolean, detail?: string) {
  if (condition) {
    passed += 1;
    console.log(`  ok   ${label}`);
  } else {
    failures.push(`${label}${detail ? ` — ${detail}` : ""}`);
    console.log(`  FAIL ${label}${detail ? ` — ${detail}` : ""}`);
  }
}

console.log("\nREADING THE FILE");
{
  const rows = parseCsv('a,b\n1,2\n');
  check("plain rows", JSON.stringify(rows) === '[["a","b"],["1","2"]]', JSON.stringify(rows));

  const quoted = parseCsv('name,address\n"Petersen, Jean","418 Cedar St, Austin"\n');
  check(
    "a comma inside quotes stays in its cell",
    quoted[1]?.[0] === "Petersen, Jean" && quoted[1]?.[1] === "418 Cedar St, Austin",
    JSON.stringify(quoted[1])
  );

  const multiline = parseCsv('name,notes\n"Ray","Gate code 4412\nDog in the yard"\n');
  check(
    "a newline inside quotes stays in its cell",
    multiline.length === 2 && multiline[1][1] === "Gate code 4412\nDog in the yard",
    JSON.stringify(multiline)
  );

  const escaped = parseCsv('name\n"She said ""yes"""\n');
  check(
    "doubled quotes become one",
    escaped[1]?.[0] === 'She said "yes"',
    JSON.stringify(escaped[1])
  );

  const excel = parseCsv('﻿"name","phone"\r\n"Dana","512-555-0143"\r\n');
  check(
    "Excel's byte-order mark and CRLF",
    excel[0]?.[0] === "name" && excel[1]?.[1] === "512-555-0143",
    JSON.stringify(excel)
  );

  const ragged = parseCsv("name,email,phone\nDana,dana@example.test\nRay\n");
  check(
    "a short row is a row, not an error",
    ragged.length === 3 && ragged[2].length === 1,
    JSON.stringify(ragged)
  );

  const blanks = parseCsv("name,email\nDana,dana@example.test\n,,\n\n");
  check(
    "blank lines and comma-only lines are dropped",
    blanks.length === 2,
    JSON.stringify(blanks)
  );

  const noTrailingNewline = parseCsv("name\nDana");
  check(
    "a file with no trailing newline keeps its last row",
    noTrailingNewline.length === 2 && noTrailingNewline[1][0] === "Dana",
    JSON.stringify(noTrailingNewline)
  );
}

let scratchOrg: string | null = null;

try {
  const [org] = await db.execute<{ id: string }>(
    sql`insert into organizations (name, slug)
        values ('Import Check', ${`import-check-${Date.now()}`})
        returning id`
  );
  scratchOrg = org.id;

  // Somebody already in the directory, and a practice customer that must never
  // be matched against.
  await db.execute(
    sql`insert into customers (organization_id, name, email)
        values (${org.id}, 'Dana Whitfield', 'dana@example.test')`
  );
  await db.execute(
    sql`insert into customers (organization_id, name, is_demo)
        values (${org.id}, 'Practice Person', true)`
  );

  console.log("\nWHAT THE FILE WOULD DO");
  {
    const csv = [
      '"Client Name","E-Mail","Cell Phone","Mailing Address","Job count"',
      '"Ray Brody","ray@example.test","512-555-0143","9 Oak St",4',
      '"dana whitfield","dana@example.test",,,2',
      '"Ray Brody","ray2@example.test",,,1',
      '"Nora Vance","not-an-email",,,0',
      '"",,,,0',
      '"Practice Person",,,,0',
    ].join("\r\n");

    const preview = await previewCustomerImport(org.id, csv);

    check("the file is readable", preview.problem === null, String(preview.problem));
    check(
      "headings are matched however they're spelled",
      preview.columns.map((column) => column.field).join(",") ===
        "name,email,phone,address",
      JSON.stringify(preview.columns)
    );
    check(
      "columns it doesn't know are named, not dropped silently",
      preview.ignored.join(",") === "Job count",
      JSON.stringify(preview.ignored)
    );

    const byLine = new Map(preview.rows.map((row) => [row.line, row]));
    check("a new customer reads as new", byLine.get(2)?.verdict === "new");
    check(
      "somebody already here is flagged, whatever the case",
      byLine.get(3)?.verdict === "duplicate" &&
        /already in your customers/i.test(byLine.get(3)?.reason ?? ""),
      JSON.stringify(byLine.get(3))
    );
    check(
      "a name repeated inside the file is flagged too",
      byLine.get(4)?.verdict === "duplicate",
      JSON.stringify(byLine.get(4))
    );
    check(
      "a bad email stops the row",
      byLine.get(5)?.verdict === "invalid",
      JSON.stringify(byLine.get(5))
    );
    check(
      "a row with no name stops too",
      byLine.get(6)?.verdict === "invalid",
      JSON.stringify(byLine.get(6))
    );
    check(
      "a practice customer is never matched against",
      byLine.get(7)?.verdict === "new",
      JSON.stringify(byLine.get(7))
    );
    check(
      "the counts add up",
      preview.counts.new === 2 &&
        preview.counts.duplicate === 2 &&
        preview.counts.invalid === 2,
      JSON.stringify(preview.counts)
    );
    check("nothing was written by the preview", await customerCount(org.id) === 2,
      `${await customerCount(org.id)} customers`);
  }

  console.log("\nA FILE IT WON'T TOUCH");
  {
    const noName = await previewCustomerImport(
      org.id,
      "Invoice,Amount\nINV-1,100\n"
    );
    check(
      "no name column -> says so, and names what it saw",
      /needs a column for the customer's name/.test(noName.problem ?? "") &&
        /Invoice, Amount/.test(noName.problem ?? ""),
      String(noName.problem)
    );

    const empty = await previewCustomerImport(org.id, "\n\n");
    check("an empty file -> says so", /empty/i.test(empty.problem ?? ""), String(empty.problem));

    const huge = ["name", ...Array.from({ length: 2001 }, (_, i) => `Person ${i}`)].join("\n");
    check(
      "a file past the row cap -> says so",
      /2000 at a time/.test((await previewCustomerImport(org.id, huge)).problem ?? ""),
      String((await previewCustomerImport(org.id, huge)).problem)
    );
  }

  console.log("\nBRINGING THEM IN");
  {
    const before = await customerCount(org.id);
    const { created } = await commitCustomerImport(org.id, [
      { name: "Ray Brody", email: "ray@example.test", phone: "512-555-0143" },
      { name: "Nora Vance", address: "9 Oak St", notes: null },
    ]);
    check("it writes what it was given", created === 2, `${created}`);
    check(
      "and nothing else",
      (await customerCount(org.id)) === before + 2,
      `${before} -> ${await customerCount(org.id)}`
    );

    const [ray] = await db.execute<{ name: string; email: string; phone: string }>(
      sql`select name, email, phone from customers
          where organization_id = ${org.id} and name = 'Ray Brody'`
    );
    check(
      "the fields land where they belong",
      ray?.email === "ray@example.test" && ray?.phone === "512-555-0143",
      JSON.stringify(ray)
    );

    // And now the same file would call him a duplicate.
    const again = await previewCustomerImport(
      org.id,
      "name,email\nRay Brody,ray@example.test\n"
    );
    check(
      "importing the same list twice flags everyone",
      again.counts.duplicate === 1 && again.counts.new === 0,
      JSON.stringify(again.counts)
    );
  }
} finally {
  if (scratchOrg) {
    await db.execute(sql`delete from organizations where id = ${scratchOrg}`);
  }
  await db.$client.end({ timeout: 5 });
}

async function customerCount(organizationId: string): Promise<number> {
  const [row] = await db.execute<{ n: number }>(
    sql`select count(*)::int as n from customers where organization_id = ${organizationId}`
  );
  return row?.n ?? 0;
}

console.log(
  `\n${passed} passed, ${failures.length} failed.` +
    (failures.length ? `\n\n${failures.map((f) => `  - ${f}`).join("\n")}\n` : "\n")
);

process.exit(failures.length ? 1 : 0);
