import Link from "next/link";
import type { Metadata } from "next";

import { CustomerImport } from "@/components/office/customer-import";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";

export const metadata: Metadata = { title: "Import customers" };

/**
 * Import · job O4.
 *
 * **Import is an alternative, never a prerequisite.** A contractor with a
 * spreadsheet should be able to bid before they migrate anything, so this is a
 * door off the Data page rather than a step in setting up.
 *
 * Customers first because that is the list a shop actually has in a
 * spreadsheet, and because it is the one whose rows can be judged honestly:
 * a name either matches somebody in the directory or it doesn't. Past quotes
 * and pricing carry a scope tree and a set of pricing decisions, and guessing
 * either of those from a spreadsheet would put numbers nobody chose on a
 * document that goes to a homeowner.
 */
export default function ImportPage() {
  return (
    <div className="flex flex-col gap-8">
      <PageHeader
        title="Bring in your customers"
        description="From a spreadsheet, or your old software's export. You see every row before anything is saved."
        actions={
          <Button asChild variant="ghost">
            <Link href="/office/data">Back to data</Link>
          </Button>
        }
      />

      <CustomerImport />
    </div>
  );
}
