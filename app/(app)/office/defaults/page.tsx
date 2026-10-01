import type { Metadata } from "next";

import { PageHeader } from "@/components/page-header";
import { DefaultsForm } from "@/components/office/defaults-form";
import { StoredSignature } from "@/components/office/stored-signature";
import { getCurrentUser, requireActiveOrganization } from "@/lib/dal";
import { getOfficeDefaults } from "@/lib/queries/office";

export const metadata: Metadata = { title: "Defaults" };

/**
 * Screen 41 · money and scope defaults · job CF1.
 *
 * **Named "Defaults", not "starting numbers & wording".** One term per concept,
 * everywhere it appears — the route is `/office/defaults`, the editor's inline
 * prompt calls it a default, and the plain-language version is the subhead
 * rather than the label.
 *
 * The notice that has to be on this page: **a default is a starting value.**
 * Changing one applies to the next quote. Anything already created, and
 * anything already sent, stays exactly as it is — which is the first question a
 * contractor asks before touching any of these.
 *
 * The business's signature on contracts sits beneath them and saves on its
 * own: it lives with the defaults because it too applies to what comes next,
 * never to a contract already signed.
 */
export default async function DefaultsPage() {
  const org = await requireActiveOrganization();
  const [defaults, profile] = await Promise.all([
    getOfficeDefaults(org.id),
    getCurrentUser(),
  ]);

  return (
    <div className="flex flex-col gap-8">
      <PageHeader
        title="Defaults"
        description="Starting numbers and wording for every new quote."
      />
      <DefaultsForm defaults={defaults} />
      <StoredSignature
        stored={{
          printedName: defaults.signatureName,
          mark: defaults.signatureMark,
          autoSign: defaults.autoSignContracts,
        }}
        personName={profile?.fullName ?? null}
      />
    </div>
  );
}
