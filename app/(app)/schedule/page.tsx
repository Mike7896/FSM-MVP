import type { Metadata } from "next";

import { SchedulePlanner } from "@/components/schedule/schedule-planner";
import { requireActiveOrganization, requireSession } from "@/lib/dal";
import type { ScheduleView } from "@/lib/schedule/dates";
import { listTeam } from "@/lib/schedule";

export const metadata: Metadata = { title: "Schedule" };

const VIEWS = new Set<ScheduleView>(["day", "week", "month"]);

/**
 * The schedule — every visit, laid out in time.
 *
 * **A work surface, so it takes the whole content region**, like the quote
 * editor: its own toolbar, a rail, and a grid that scrolls inside itself rather
 * than a card floating in a padded page.
 *
 * The team is read here — it's the same for every week — and the visits are
 * fetched by the page per window, because a calendar is paged through far
 * faster than a server page should be re-rendered.
 *
 * `?view`, `?date` and `?visit` are how a notification or a job page links
 * straight to a day, or to one visit on it.
 */
export default async function SchedulePage({
  searchParams,
}: PageProps<"/schedule">) {
  const [org, session] = await Promise.all([
    requireActiveOrganization(),
    requireSession(),
  ]);
  const [team, params] = await Promise.all([listTeam(org.id), searchParams]);

  const view = typeof params.view === "string" && VIEWS.has(params.view as ScheduleView)
    ? (params.view as ScheduleView)
    : null;
  const date =
    typeof params.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(params.date)
      ? params.date
      : null;
  const visitId = typeof params.visit === "string" ? params.visit : null;
  const bookTask =
    typeof params.book === "string" && /^[0-9a-f-]{36}$/i.test(params.book) ? params.book : null;

  return (
    // Cancels the layout's padding, and fills the height under the header —
    // the grid scrolls inside itself, the page doesn't.
    <div className="-mx-4 -my-6 h-[calc(100svh-3.5rem)] md:-mx-8 md:-my-8">
      <SchedulePlanner
        team={team}
        me={session.userId}
        initial={{ view, date, visitId, bookTask }}
      />
    </div>
  );
}
