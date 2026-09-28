import type { Metadata } from "next";

import { IdentityForm } from "@/components/office/identity-form";
import { PageHeader } from "@/components/page-header";
import { requireActiveOrganization } from "@/lib/dal";
import { getOffice, getOfficeDefaults, getOfficeIdentity } from "@/lib/queries/office";
import { presetLabel } from "@/lib/branding";

export const metadata: Metadata = { title: "Business identity" };

/**
 * Screen 27 · the Office's own attributes · job O2.
 *
 * **These are attributes, not an object.** The Office has structure but one
 * instance and no lifecycle, so it names a place in the model and a destination
 * in the interface rather than a thing with a list (Object Model §5.1). What
 * lives here is the identity every outbound document draws on — which is what
 * lets a document header cite a defined source instead of an undefined profile
 * field.
 *
 * The Office supplies this to every document and is never edited from one, so
 * this page is the only place it is written.
 */
export default async function OfficePage() {
  const org = await requireActiveOrganization();

  // The two rows that point out at other Office pages carry their live value,
  // and the header preview shows the number a document would actually go out
  // with — so both are read here rather than described.
  const [office, identity, defaults] = await Promise.all([
    getOffice(org.id),
    getOfficeIdentity(org.id),
    getOfficeDefaults(org.id),
  ]);

  if (!office) {
    // `requireActiveOrganization` redirects when there is no organization, so
    // reaching here means the membership outlived the row it pointed at.
    throw new Error("The active organization no longer exists.");
  }

  return (
    <div className="flex flex-col gap-8">
      <PageHeader
        title="Business identity"
        description="Who you are on every quote, contract and invoice you send."
      />
      <IdentityForm
        office={office}
        license={identity.license}
        presetName={presetLabel(defaults?.documentPreset ?? null)}
      />
    </div>
  );
}
