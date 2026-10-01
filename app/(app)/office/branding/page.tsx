import Link from "next/link";
import type { Metadata } from "next";

import { BrandingForm } from "@/components/office/branding-form";
import { PageHeader } from "@/components/page-header";
import { requireActiveOrganization } from "@/lib/dal";
import { getAccess } from "@/lib/membership/access";
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
 * to the business and lives in the Office.
 *
 * **Your logo on documents is a Pro feature** (Billing §2.2). The setting is
 * open to everyone — it's the shop's own mark, and it's kept — but only Pro
 * puts it on what goes out, and the page says so rather than letting a
 * contractor set it up and wonder why it never appears.
 */
export default async function BrandingPage() {
  const org = await requireActiveOrganization();

  const [defaults, identity, office, access] = await Promise.all([
    getOfficeDefaults(org.id),
    getOfficeIdentity(org.id),
    getOffice(org.id),
    getAccess(org.id),
  ]);

  return (
    <div className="flex flex-col gap-8">
      <PageHeader
        title="Document branding"
        description="How your quotes, contracts and invoices look to a customer. Pick one — the panel on the right is what she sees on her phone."
      />
      {access.features.branding ? null : (
        <p className="rounded-lg border px-4 py-3 text-sm">
          Your logo goes on documents with <strong className="font-medium">Pro</strong>. You can set it up now — it
          appears on everything you send once you&apos;re on Pro, and documents already sent keep the look they went out
          with.{" "}
          <Link href="/account/billing/plan" className="text-primary-ink underline underline-offset-4">
            See Pro
          </Link>
        </p>
      )}
      <BrandingForm
        canSave={access.features.branding}
        preset={defaults?.documentPreset ?? null}
        identity={identity}
        logoUrl={office?.logoUrl ?? null}
      />
    </div>
  );
}
