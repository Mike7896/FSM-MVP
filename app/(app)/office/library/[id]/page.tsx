import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { SavedItemEditor } from "@/components/library/saved-item-editor";
import { requireActiveOrganization } from "@/lib/dal";
import { getSavedItem } from "@/lib/queries/library";

export const metadata: Metadata = { title: "Library item" };

/** One saved item, opened from the Library to change its rows, settings and defaults. */
export default async function LibraryItemPage({
  params,
}: PageProps<"/office/library/[id]">) {
  const org = await requireActiveOrganization();
  const { id } = await params;
  const item = await getSavedItem(id, org.id);
  if (!item) notFound();

  // Keyed by when it was last saved, so a refresh after saving starts the
  // editor from what's stored rather than from its own copy.
  return <SavedItemEditor key={item.updatedAt} item={item} />;
}
