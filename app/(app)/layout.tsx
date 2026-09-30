import { PresenceBeacon } from "@/components/admin/presence-beacon";
import { redirect } from "next/navigation";

import { AppHeader } from "@/components/app-header";
import { AppSidebar } from "@/components/app-sidebar";
import { getCurrentAdmin } from "@/lib/admin/access";
import { NotificationsProvider } from "@/components/notifications/notifications-provider";
import { TourProvider } from "@/components/tours/tour-provider";
import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar";
import { getCurrentUser, getUserOrganizations, requireSession } from "@/lib/dal";
import { FreeLimitSheet } from "@/components/billing/free-limit-sheet";
import { getBillSummary } from "@/lib/membership/bill";
import { listTourProgress } from "@/lib/queries/tours";

/**
 * The contractor's desk shell — surface class B, sidebar navigation, which
 * survives down to ~768px where tablet inherits it.
 *
 * Two gates, and both are load-bearing:
 *
 * **A session.** The proxy already made an optimistic cookie check;
 * `requireSession()` is the one that actually counts, because Server Functions
 * are POSTs to the route they live on and a proxy matcher can silently stop
 * covering one.
 *
 * **An Office.** Every surface behind this layout is scoped to an organization,
 * so a signed-in contractor without one has nothing to look at — every list is
 * empty and every create path has nowhere to write. Journey 0 is where an
 * account's Office comes from, so that is where they go. Without this check the
 * app renders a fully-furnished dashboard to someone who owns none of it, which
 * is exactly the "empty app with a nav bar" the activation journey exists to
 * prevent.
 *
 * `/welcome` lives in the `(activation)` group rather than this one, so there
 * is no redirect loop.
 */
export default async function AppLayout({ children }: LayoutProps<"/">) {
  const session = await requireSession();
  const organizations = await getUserOrganizations();

  if (organizations.length === 0) {
    redirect("/welcome");
  }

  // The chrome carries two names a few pixels apart — the business's in the
  // header, the person's on the account menu — because that adjacency is the
  // whose-thing-is-it split made visible (wireframe 94 · 56c).
  const [profile, billSummary, tours, admin] = await Promise.all([
    getCurrentUser(),
    getBillSummary(organizations[0].id),
    // Seeded here so the tour system knows what this person has finished on
    // the first render — nothing opens and then snaps shut.
    listTourProgress(session.userId),
    getCurrentAdmin(),
  ]);

  return (
    <TourProvider initialProgress={tours}>
      {/* The bell and the pop-ups, for everything behind this layout. */}
      <NotificationsProvider>
      {/* "Someone has the app open" for the admin dashboard — area only. */}
      <PresenceBeacon />
      {/* The upgrade prompt, over whatever draft hit the Free job limit. */}
      <FreeLimitSheet />
      <SidebarProvider>
        <AppSidebar
          businessName={organizations[0].name}
          personName={profile?.fullName ?? null}
          userEmail={session.email}
          monthlyTotal={billSummary}
          isAdmin={admin !== null}
        />
        {/* `min-w-0`: a wide board scrolls inside its page instead of
            stretching the page past the window. */}
        <SidebarInset className="min-w-0">
          <AppHeader />
          <div className="flex flex-1 flex-col px-4 py-6 [--workspace-max-width:100rem] md:px-8 md:py-8">{children}</div>
        </SidebarInset>
      </SidebarProvider>
      </NotificationsProvider>
    </TourProvider>
  );
}
