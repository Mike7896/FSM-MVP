import { notFound, redirect } from "next/navigation";

import {
  SentScreen,
  type SentPlace,
} from "@/components/quote-send/sent-screen";
import { getCurrentUser, requireActiveOrganization } from "@/lib/dal";
import { emailConfigured } from "@/lib/email/send";
import { getOfficeIdentity } from "@/lib/queries/office";
import { getQuoteTimeline } from "@/lib/queries/quote-timeline";
import { canAcceptPayments, getConnectedAccount } from "@/lib/stripe/connect";

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * The send confirmation, read — shared by the two places it lives.
 *
 * `/welcome/sent/[id]` is where the first send lands, outside the app shell like
 * the rest of activation; `/quotes/[id]/sent` is the same screen reached again
 * from inside the app. One loader, so which offers apply and whether the teach
 * beat has been spent cannot be decided two ways.
 */
export async function SentPage({
  quoteId,
  place,
}: {
  quoteId: string;
  place: SentPlace;
}) {
  if (!UUID.test(quoteId)) notFound();

  const org = await requireActiveOrganization();
  const [timeline, profile, office, account] = await Promise.all([
    getQuoteTimeline(quoteId, org.id),
    getCurrentUser(),
    getOfficeIdentity(org.id),
    getConnectedAccount(org.id),
  ]);

  if (!timeline) notFound();
  // Never sent: nothing to confirm yet. Back to the quote.
  if (!timeline.quote.sentAt) redirect(`/quotes/${quoteId}`);

  const { demo, depositCents } = timeline.quote;

  return (
    <SentScreen
      timeline={timeline}
      place={place}
      now={new Date().toISOString()}
      emailEnabled={emailConfigured()}
      teach={!demo && !profile?.teachSeenAt}
      offers={
        demo || profile?.offersDismissedAt
          ? null
          : {
              // Withheld at the letterhead on purpose — the one gap with no
              // cost at send time, so it earns its place here instead.
              logo: !office.logoUrl,
              // Payment setup is offered only against a deposit he actually
              // asked for, and only while cards can't be taken yet.
              deposit:
                depositCents !== null &&
                depositCents > 0 &&
                !canAcceptPayments(account),
            }
      }
    />
  );
}
