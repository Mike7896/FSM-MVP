import { redirect } from "next/navigation";
import type { Metadata } from "next";

import { StartChoice } from "@/components/activation/start-choice";
import { PurchaseStart } from "@/components/activation/purchase-start";
import { purchaseQuery, signupDestination } from "@/lib/membership/purchase-intent";
import {
  getActiveOrganization,
  getCurrentUser,
  verifySession,
} from "@/lib/dal";
import { getStartState } from "@/lib/queries/activation";
import { tradeFromDoor } from "@/lib/trades";

export const metadata: Metadata = { title: "Your first quote" };

/**
 * Screen 3 · Flow 1 · the post-auth landing — a choice, not a tour.
 *
 * Never an empty dashboard. A contractor who has just signed up and lands on a
 * nav bar with nothing in it has been given a settings project, and the
 * spreadsheet wins.
 *
 * Who sees what:
 * - **First visit** — the trade question unless a trade door answered it, then
 *   the three starts.
 * - **Back, with nothing real sent** — the same starts without a second
 *   welcome, carrying the demo if he built one (3c).
 * - **Back, with a real draft** — not this screen at all. Straight to the draft;
 *   never make him re-choose over work in progress.
 * - **A real quote already out** — the start is behind him; the dashboard.
 */
export default async function WelcomePage({
  searchParams,
}: PageProps<"/welcome">) {
  const incoming = await searchParams;
  const session = await verifySession();
  if (!session) redirect(`/login?next=${encodeURIComponent(signupDestination(incoming))}`);
  const [profile, org, params] = await Promise.all([
    getCurrentUser(),
    getActiveOrganization(),
    incoming,
  ]);
  const { trade } = params;
  const purchase = purchaseQuery(params);
  if (purchase) {
    if (org) redirect(`/upgrade/checkout?${purchase}`);
    return <PurchaseStart query={purchase} />;
  }

  const start = org ? await getStartState(org.id) : null;

  if (start && start.realSent > 0) redirect("/dashboard");
  if (start?.realDraft) redirect(`/quotes/${start.realDraft.id}`);

  // The first name, or the part of the email before any separator.
  const name =
    profile?.fullName?.trim().split(/\s+/)[0] ||
    session.email.split("@")[0].split(/[._-]/)[0] ||
    null;

  // Only a trade he hasn't already given is worth saving from the door.
  const doorTrade = profile?.trade
    ? null
    : tradeFromDoor(typeof trade === "string" ? trade : null);

  return (
    <StartChoice
      firstName={name ? capitalize(name) : null}
      returning={org !== null}
      hasOrganization={org !== null}
      demoQuote={start?.demoQuote ?? null}
      askTrade={org === null && !profile?.trade && !doorTrade}
      doorTrade={doorTrade}
    />
  );
}

function capitalize(value: string) {
  return value.charAt(0).toUpperCase() + value.slice(1);
}
