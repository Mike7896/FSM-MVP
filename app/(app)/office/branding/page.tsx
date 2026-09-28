import type { Metadata } from "next";

import { BrandingForm } from "@/components/office/branding-form";
import { PageHeader } from "@/components/page-header";
import { requireActiveOrganization } from "@/lib/dal";
import {
  getOffice,
  getOfficeDefaults,
  getOfficeIdentity,
} from "@/lib/queries/office";

export const metadata: Metadata = { title: "Document branding" };

/**
 * Screen 42 · document branding · jobs CF1, O2. Wireframe 94 · 34c.
 *
 * **Renamed, and the rename is the point.** This screen used to be called
 * *Appearance*, which is now the app's light-or-dark switch in Settings.
 * Document branding is how the *business* looks to a homeowner, so it belongs
 * to the business and lives in the Office. Two words, two destinations, one
 * boundary that was previously a single overloaded label.
 */
export default async function BrandingPage() {
  const org = await requireActiveOrganization();

  const [defaults, identity, office] = await Promise.all([
    getOfficeDefaults(org.id),
    getOfficeIdentity(org.id),
    getOffice(org.id),
  ]);

  return (
    <div className="flex flex-col gap-8">
      <PageHeader
        title="Document branding"
        description="How your quotes, contracts and invoices look to a customer. Pick one — the panel on the right is what she sees on her phone."
      />
      <BrandingForm
        preset={defaults?.documentPreset ?? null}
        identity={identity}
        logoUrl={office?.logoUrl ?? null}
      />
    </div>
  );
}
