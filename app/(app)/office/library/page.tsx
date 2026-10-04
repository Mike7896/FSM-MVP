import type { Metadata } from "next";

import { LibraryList } from "@/components/library/library-list";
import { PageHeader } from "@/components/page-header";
import { requireActiveOrganization } from "@/lib/dal";
import { listSavedItems } from "@/lib/queries/library";

export const metadata: Metadata = { title: "Library" };

/**
 * The Library, in the Office — every saved line item, group and assembly, and
 * the settings that size them (UX: Saved Items and Job Settings).
 *
 * **The quote editor's Library tab is for using items; this is for keeping
 * them.** Renaming one, changing its rows, giving it settings and setting its
 * defaults is done once for every quote, so it lives with the rest of the
 * shop's setup rather than in a side panel beside a customer's quote.
 */
export default async function LibraryPage() {
  const org = await requireActiveOrganization();
  const items = await listSavedItems(org.id);

  return (
    <div className="flex flex-col gap-8">
      <PageHeader
        title="Library"
        description="Saved line items, groups and assemblies, ready to drop into any quote."
      />
      <LibraryList items={items} />
    </div>
  );
}
