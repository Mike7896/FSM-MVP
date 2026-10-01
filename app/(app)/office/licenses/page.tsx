import type { Metadata } from "next";

import { PageHeader } from "@/components/page-header";
import { LicenseManager } from "@/components/office/license-manager";
import { requireActiveOrganization } from "@/lib/dal";
import { listLicenseGaps, listLicenses } from "@/lib/queries/office";

export const metadata: Metadata = { title: "Licenses" };

/**
 * Screen 45 · the License Manager · differentiator #6, job L1.
 *
 * **License is the Office's; Permit is the Job's.** A credential the business
 * holds and renews on a calendar, versus authorisation for one address that
 * closes when the final inspection passes. They meet at the jurisdiction and
 * nowhere else.
 *
 * The gap warning is computed from the jobs that exist rather than asserted,
 * which is what makes it worth reading — and its consequence is not cosmetic: a
 * township that licenses its own contractors will not issue a permit to a
 * business it has no record of.
 */
export default async function LicensesPage() {
  const org = await requireActiveOrganization();

  const [licenses, gaps] = await Promise.all([
    listLicenses(org.id),
    listLicenseGaps(org.id),
  ]);

  return (
    <div className="flex flex-col gap-8">
      <PageHeader
        title="Licenses"
        description="Every credential the business holds, and the township each one covers."
      />
      <LicenseManager licenses={licenses} gaps={gaps} />
    </div>
  );
}
