import Link from "next/link";

import { Wordmark } from "@/components/brand";
import { ModeToggle } from "@/components/mode-toggle";
import { TourProvider } from "@/components/tours/tour-provider";
import { getCurrentUser, verifySession } from "@/lib/dal";
import { listTourProgress } from "@/lib/queries/tours";

/**
 * Activation runs outside the app shell, deliberately.
 *
 * The named failure mode for a first session is **an empty app with a nav
 * bar** — a brand-new contractor looking at Dashboard, Quotes, Jobs, Customers
 * and Invoices, all empty, has been handed a settings project. So this surface
 * carries a wordmark and the contractor's name, and nothing else: there is
 * exactly one thing to do here.
 *
 * **That holds at desk width too**, which is the part worth stating because it
 * looks like an omission. 3d draws the desk activation frame as `[WORDMARK] |
 * [NAME]` and says it outright: *width must not become a place to browse*. The
 * sidebar appears in 13a, which is the ordinary editor at `/quotes/…` once
 * there is a shop to navigate — every destination behind those links is scoped
 * to an organization that does not exist yet while this flow is running.
 */
export default async function ActivationLayout({ children }: LayoutProps<"/">) {
  // Null before sign-in and on the auth-error screens, which is why the name is
  // rendered conditionally rather than gated behind a session check here.
  const session = await verifySession();
  const [profile, tours] = await Promise.all([
    getCurrentUser(),
    session ? listTourProgress(session.userId) : Promise.resolve(null),
  ]);
  const name = profile?.fullName?.trim() || profile?.email || null;

  return (
    <div className="flex min-h-full flex-1 flex-col">
      <header className="flex h-14 shrink-0 items-center justify-between gap-3 border-b px-4">
        <Link href="/dashboard" className="flex items-center">
          <Wordmark />
        </Link>

        <div className="flex min-w-0 items-center gap-3">
          {name ? (
            <span className="text-muted-foreground truncate text-sm">
              {name}
            </span>
          ) : null}
          <ModeToggle />
        </div>
      </header>
      <main className="flex flex-1 flex-col">
        {/* Tours run for signed-in people only — onboarding starts in here. */}
        {tours ? (
          <TourProvider initialProgress={tours}>{children}</TourProvider>
        ) : (
          children
        )}
      </main>
    </div>
  );
}
