import { redirect } from "next/navigation";
import type { Metadata } from "next";

import { ActivationQuoteSurface } from "@/components/activation/activation-quote-surface";
import {
  getActiveOrganization,
  getCurrentUser,
  requireSession,
} from "@/lib/dal";
import { emailConfigured } from "@/lib/email/send";
import { getOfficeIdentity, getOfficeSignature } from "@/lib/queries/office";

export const metadata: Metadata = { title: "Your first quote" };

/**
 * The activation editor — **the same quote editor, with the onboarding tour
 * running over it** from the tour system in the layout.
 *
 * Two ways in, from the start choice: `?seed=` is the real start, carrying the
 * sentence he typed; `?demo=1` is the demo start, a blank practice quote that
 * can only be sent to himself.
 *
 * **This lives in the activation group, not the app shell, and that is
 * load-bearing.** Journey 0's premise is that the contractor builds a real
 * quote *before* he has an Office — it is created partway through, at the
 * letterhead gap. The app shell requires one, so hosting this route there would
 * bounce him back to `/welcome` the moment he started.
 */
export default async function ActivationQuotePage({
  searchParams,
}: PageProps<"/welcome/quote">) {
  const session = await requireSession();
  const { seed, demo } = await searchParams;

  const isDemo = demo === "1";
  const seedText =
    typeof seed === "string" && seed.trim().length > 0 ? seed : undefined;

  // The real start without its sentence — send him back to write one rather
  // than opening an empty editor, which is the thing the start screen exists
  // to prevent. The demo start is blank on purpose.
  if (!isDemo && !seedText) redirect("/welcome");

  const [profile, org] = await Promise.all([
    getCurrentUser(),
    getActiveOrganization(),
  ]);

  // Usually no Office yet, and the preview draws the gaps rather than blocking
  // on them. A contractor who reached this screen with one keeps its details.
  const office = org
    ? {
        ...(await getOfficeIdentity(org.id)),
        signature: await getOfficeSignature(org.id),
      }
    : {
        businessName: null,
        license: null,
        phone: profile?.phone ?? null,
        logoUrl: null,
      };

  return (
    <ActivationQuoteSurface
      // Remounted when the start changes, so the draft follows the URL rather
      // than whichever start was opened first in this tab.
      key={isDemo ? "demo" : seedText}
      seedText={isDemo ? undefined : seedText}
      demo={isDemo}
      office={office}
      hasOrganization={org !== null}
      send={{
        emailEnabled: emailConfigured(),
        selfEmail: session.email,
        selfPhone: profile?.phone ?? null,
        customerEmail: null,
      }}
    />
  );
}
