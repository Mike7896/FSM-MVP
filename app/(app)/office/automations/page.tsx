import type { Metadata } from "next";

import { AutomationsPanel } from "@/components/office/automations-panel";
import { PageHeader } from "@/components/page-header";
import { requireActiveOrganization } from "@/lib/dal";
import { getOfficeIdentity } from "@/lib/queries/office";

export const metadata: Metadata = { title: "Automations" };

/**
 * Screen 43 · automations · job CF2. Wireframe 94 · 34a.
 *
 * **This is where the whole-system automation claim is either trusted or
 * switched off**, which is why it is one of the two Office screens drawn at
 * differentiator depth.
 *
 * **It is in the Office because it speaks for the business.** A follow-up goes
 * out under the business's name, from its number, and replies land with the
 * contractor — so it is the business's thing. Which channel *he* hears about a
 * draw on is the app's thing, and that is Settings → Notifications. The two
 * screens name each other so the line is legible from both sides.
 *
 * **Defaults must be good enough that this screen never gets visited.** It
 * exists to be available, not required. A contractor who has to configure
 * automations before the product behaves sanely does not have an automation
 * differentiator, they have a chore.
 */
export default async function AutomationsPage() {
  const org = await requireActiveOrganization();
  // The message previews carry the shop's own name rather than an invented one.
  const identity = await getOfficeIdentity(org.id);

  return (
    <div className="flex flex-col gap-8">
      <PageHeader
        title="Automations"
        description="What the app does without you."
      />

      {/* Honest about where this surface actually is. Every control below is
          drawn to the wireframe and none of them is stored yet — there is no
          automations table in the model, and a page that silently discarded a
          contractor's quiet hours would be worse than one that says so. */}
      <p className="text-muted-foreground rounded-xl border border-dashed p-5 text-sm">
        <strong className="text-foreground font-medium">
          The customer-facing automations don&apos;t save yet.
        </strong>{" "}
        The behaviours under &ldquo;Speaks to my customers&rdquo; are the ones
        the product will run and the wording is what your customer would
        actually receive, but those switches don&apos;t persist yet. What
        reaches <em>you</em> is live — it&apos;s chosen in Settings →
        Notifications.
      </p>

      <AutomationsPanel businessName={identity.businessName} />
    </div>
  );
}
