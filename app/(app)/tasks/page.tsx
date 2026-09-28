import type { Metadata } from "next";

import { TasksPlanner, type TasksView } from "@/components/tasks/tasks-planner";
import type { GroupBy } from "@/components/tasks/task-list";
import { requireActiveOrganization, requireSession } from "@/lib/dal";
import { listTags } from "@/lib/queries/tags";
import { listTeam } from "@/lib/schedule";
import { tagIds } from "@/lib/tags";
import { jobForPicker } from "@/lib/tasks";

export const metadata: Metadata = { title: "Tasks" };

const VIEWS = new Set<TasksView>(["list", "board"]);
const GROUPS = new Set<GroupBy>(["status", "job", "person"]);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Tasks — every task in the shop, as a list or a board.
 *
 * **A work surface, so it takes the whole content region**, like the schedule:
 * its own toolbar, and a list or board that scrolls inside itself.
 *
 * The team and the shop's tags are read here — they're the same for every
 * filter — and the tasks are fetched by the page, because a board is dragged
 * about far faster than a server page should re-render.
 *
 * Every filter is in the address: `?task` opens one (what a notification links
 * to), `?job` narrows to a job (what the job's page links to), `?assignee=me`
 * is "my tasks".
 */
export default async function TasksPage({ searchParams }: PageProps<"/tasks">) {
  const [org, session] = await Promise.all([requireActiveOrganization(), requireSession()]);
  const params = await searchParams;
  const one = (key: string) => (typeof params[key] === "string" ? (params[key] as string) : null);

  const jobId = one("job");
  const [team, tags, job] = await Promise.all([
    listTeam(org.id),
    listTags(org.id),
    jobId && UUID.test(jobId) ? jobForPicker(org.id, jobId) : null,
  ]);

  const view = one("view");
  const group = one("group");
  const taskId = one("task");
  const assignee = one("assignee");

  return (
    // Cancels the layout's padding and fills the height under the header.
    <div className="-mx-4 -my-6 h-[calc(100svh-3.5rem)] md:-mx-8 md:-my-8">
      <TasksPlanner
        team={team}
        me={session.userId}
        organizationId={org.id}
        tags={tags}
        initial={{
          view: view && VIEWS.has(view as TasksView) ? (view as TasksView) : null,
          group: group && GROUPS.has(group as GroupBy) ? (group as GroupBy) : null,
          taskId: taskId && UUID.test(taskId) ? taskId : null,
          job,
          assignee:
            assignee === "me"
              ? session.userId
              : assignee === "none" || (assignee && UUID.test(assignee))
                ? assignee
                : null,
          q: one("q"),
          tagIds: tagIds(one("tags") ?? undefined),
        }}
      />
    </div>
  );
}
