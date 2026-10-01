import Link from "next/link";
import type { Metadata } from "next";
import { Download, Upload } from "lucide-react";

import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { requireActiveOrganization } from "@/lib/dal";
import { EXPORT_TABLES, exportEverything } from "@/lib/export/tables";

export const metadata: Metadata = { title: "Data" };

/**
 * Data · jobs O4 (import), X1 (export), B1 (accountant handoff).
 *
 * **Export is the anti-lock-in promise that makes import safe.** A contractor
 * asked to bring years of spreadsheets into a new tool is being asked to trust
 * it with the only copy; the answer is that everything leaves as easily as it
 * arrived, and that it is available always rather than at cancellation.
 *
 * **Counted, not claimed.** Each set says how many rows are in it, because a
 * row count is the difference between "we have your data" and showing it. The
 * numbers come from the export itself rather than a second set of queries —
 * one source, so the count and the file can never disagree.
 *
 * Import and the accountant packet are named and said to be unbuilt rather
 * than drawn as buttons that do nothing.
 */
export default async function DataPage() {
  const org = await requireActiveOrganization();
  const everything = await exportEverything(org.id);
  const total = Object.values(everything).reduce(
    (sum, set) => sum + set.rows.length,
    0
  );

  return (
    <div className="flex flex-col gap-8">
      <PageHeader
        title="Data"
        description="Bring your customers in, and take everything out whenever you want."
      />

      <section className="rounded-lg border p-5">
        <div className="flex flex-col items-start gap-4 @xl/office:flex-row @xl/office:justify-between">
          <div>
            <h2 className="flex items-center gap-2 font-medium">
              <Download className="size-4" />
              Everything, in one file
            </h2>
            <p className="text-muted-foreground mt-1 text-sm">
              {total === 0
                ? "Nothing to take yet — this fills up as you quote, bill and get paid."
                : `Every record below — ${total} in total — in one JSON file, for moving to another system.`}
            </p>
          </div>
          {/* No button at all on an empty account. A disabled control on an
              anchor is a lie twice over — it still navigates. */}
          {total === 0 ? null : (
            <Button asChild className="shrink-0">
              <a href="/api/v1/export" download>
                Download everything
              </a>
            </Button>
          )}
        </div>
      </section>

      <section className="rounded-lg border p-5">
        <h2 className="font-medium">One set at a time</h2>
        <p className="text-muted-foreground mt-1 text-sm">
          A spreadsheet your bookkeeper can open, with money in dollars and
          every column named in plain words. Practice jobs aren&apos;t included.
        </p>

        <div className="mt-4 flex flex-col">
          {EXPORT_TABLES.map((table) => {
            const count = everything[table.id].rows.length;

            return (
              <div
                key={table.id}
                className="flex items-center justify-between gap-4 border-t py-3"
              >
                <div className="min-w-0">
                  <p className="text-sm font-medium">{table.label}</p>
                  <p className="text-muted-foreground text-xs tabular-nums">
                    {count === 0
                      ? "None yet"
                      : `${count} ${count === 1 ? "row" : "rows"}`}
                  </p>
                </div>
                {count === 0 ? null : (
                  <Button asChild variant="outline" size="sm">
                    <a href={`/api/v1/export?table=${table.id}`} download>
                      CSV
                    </a>
                  </Button>
                )}
              </div>
            );
          })}
        </div>
      </section>

      <section className="rounded-lg border p-5">
        <div className="flex flex-col items-start gap-4 @xl/office:flex-row @xl/office:justify-between">
          <div>
            <h2 className="flex items-center gap-2 font-medium">
              <Upload className="size-4" />
              Bring your customers in
            </h2>
            <p className="text-muted-foreground mt-1 text-sm">
              From a spreadsheet or your old software&apos;s export. You review
              every row before it commits — nothing lands silently, and anyone
              already in your directory is flagged rather than merged.
            </p>
          </div>
          <Button asChild variant="outline" className="shrink-0">
            <Link href="/office/data/import">Import customers</Link>
          </Button>
        </div>
      </section>

      {/* Said plainly instead of drawn as buttons. Both are real plans;
          neither is built, and a control that does nothing is worse than a
          sentence that says so. */}
      <section className="rounded-lg border border-dashed p-5">
        <h2 className="font-medium">Not built yet</h2>
        <dl className="mt-3 flex flex-col gap-3 text-sm">
          <div>
            <dt className="font-medium">Past quotes and pricing</dt>
            <dd className="text-muted-foreground mt-0.5">
              A quote carries a scope tree and five pricing decisions behind it,
              and neither can be guessed from a spreadsheet column. Customers
              import today; work history waits until it can come in whole.
            </dd>
          </div>
          <div>
            <dt className="font-medium">The accountant packet</dt>
            <dd className="text-muted-foreground mt-0.5">
              Deposits as liabilities, progress invoices reconciled, payments
              matched to jobs. Until it exists, the payments and invoices files
              above carry the same facts in plainer form.
            </dd>
          </div>
        </dl>
      </section>
    </div>
  );
}
