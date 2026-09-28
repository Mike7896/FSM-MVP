"use client";

import { useState } from "react";
import { ChevronRight, Plus } from "lucide-react";

import { jobLabel } from "@/components/jobs/job-picker";
import { TagBadges } from "@/components/tags/tag-controls";
import { Button } from "@/components/ui/button";
import type { ScheduleJob } from "@/lib/schedule/types";
import {
  isClosed,
  taskKey,
  TASK_STATUSES,
  type TaskStatus,
  type TaskView,
} from "@/lib/tasks/types";
import { cn } from "@/lib/utils";

import { Booked } from "./task-board";
import { PersonAvatar, StatusIcon } from "./task-bits";
import { AssigneeMenu, DueMenu, PriorityMenu, StatusMenu } from "./task-menus";
import type { PanelPeople, TaskDraftDefaults } from "./task-panel";
import type { TaskChange } from "./use-tasks";

/**
 * The list — every task a row, in groups.
 *
 * **Grouped by status, it's the board read down a page.** Grouped by job, it's
 * the project view: each job with its own tasks and how many are done, which
 * is the question "where are we on the Petersen job" asks. Grouped by person,
 * it's who has what.
 *
 * Every mark on a row is its own menu, so most changes never open the task.
 */

export type GroupBy = "status" | "job" | "person";

type Group = {
  key: string;
  label: string;
  icon: React.ReactNode;
  tasks: TaskView[];
  /** What a task added from this group's + starts with. */
  defaults: TaskDraftDefaults;
  /** For a job: how far along it is. */
  progress?: { done: number; total: number };
  href?: string;
};

export function TaskList({
  tasks,
  groupBy,
  people,
  onOpen,
  onChange,
  onAdd,
}: {
  tasks: TaskView[];
  groupBy: GroupBy;
  people: PanelPeople;
  onOpen: (task: TaskView) => void;
  onChange: (task: TaskView, change: TaskChange) => void;
  onAdd: (defaults: TaskDraftDefaults) => void;
}) {
  // Cancelled starts folded — it's the record, not the work.
  const [folded, setFolded] = useState<Set<string>>(() => new Set(["status:cancelled"]));
  const groups = groupTasks(tasks, groupBy, people);

  return (
    <div className="flex flex-col pb-10">
      {groups.map((group) => {
        const closed = folded.has(group.key);
        return (
          <section key={group.key} aria-label={group.label}>
            <header className="sticky top-0 z-[1] bg-[color-mix(in_oklab,var(--muted)_40%,var(--background))] flex items-center gap-2 border-y px-4 py-1.5 md:px-5">
              <button
                type="button"
                className="flex min-w-0 items-center gap-2 text-left"
                aria-expanded={!closed}
                onClick={() =>
                  setFolded((current) => {
                    const next = new Set(current);
                    if (next.has(group.key)) next.delete(group.key);
                    else next.add(group.key);
                    return next;
                  })
                }
              >
                <ChevronRight className={cn("text-muted-foreground size-3.5 shrink-0 transition-transform", !closed && "rotate-90")} />
                {group.icon}
                <span className="truncate text-sm font-medium">{group.label}</span>
                <span className="text-muted-foreground text-xs tabular-nums">{group.tasks.length}</span>
              </button>
              {group.progress ? (
                <span className="text-muted-foreground ml-1 hidden items-center gap-2 text-xs sm:flex">
                  <span className="bg-muted relative h-1.5 w-16 overflow-hidden rounded-full">
                    <span
                      className="absolute inset-y-0 left-0 rounded-full bg-emerald-500"
                      style={{ width: `${(group.progress.done / Math.max(group.progress.total, 1)) * 100}%` }}
                    />
                  </span>
                  {group.progress.done} of {group.progress.total} done
                </span>
              ) : null}
              <Button
                variant="ghost"
                size="icon"
                className="text-muted-foreground ml-auto size-7"
                aria-label={`New task in ${group.label}`}
                title={`New task in ${group.label}`}
                onClick={() => onAdd(group.defaults)}
              >
                <Plus className="size-4" />
              </Button>
            </header>
            {closed ? null : (
              <ul>
                {group.tasks.map((task) => (
                  <Row
                    key={task.id}
                    task={task}
                    groupBy={groupBy}
                    people={people}
                    onOpen={onOpen}
                    onChange={onChange}
                  />
                ))}
              </ul>
            )}
          </section>
        );
      })}
    </div>
  );
}

function Row({
  task,
  groupBy,
  people,
  onOpen,
  onChange,
}: {
  task: TaskView;
  groupBy: GroupBy;
  people: PanelPeople;
  onOpen: (task: TaskView) => void;
  onChange: (task: TaskView, change: TaskChange) => void;
}) {
  const closed = isClosed(task.status);
  return (
    <li
      role="button"
      tabIndex={0}
      onClick={() => onOpen(task)}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onOpen(task);
        }
      }}
      className="hover:bg-muted/40 focus-visible:bg-muted/60 grid cursor-pointer grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-x-2 border-b px-4 py-2 outline-none md:px-5"
    >
      <span className="flex items-center gap-0.5">
        <PriorityMenu priority={task.priority} onChange={(priority) => onChange(task, { priority })} />
        <StatusMenu status={task.status} onChange={(status) => onChange(task, { status })} />
      </span>

      <span className="flex min-w-0 flex-col gap-0.5 md:flex-row md:items-center md:gap-2">
        <span className="flex min-w-0 items-center gap-2">
          <span className="text-muted-foreground hidden shrink-0 text-xs tabular-nums sm:inline">
            {taskKey(task.number)}
          </span>
          <span className={cn("truncate text-sm", closed && "text-muted-foreground", task.status === "cancelled" && "line-through")}>
            {task.title}
          </span>
        </span>
        <span className="flex min-w-0 items-center gap-2 md:ml-auto">
          {task.tags.length ? (
            <span className="hidden shrink-0 lg:inline-flex">
              <TagBadges tags={task.tags} />
            </span>
          ) : null}
          {task.job && groupBy !== "job" ? (
            <span className="text-muted-foreground max-w-56 truncate text-xs">{jobLabel(task.job)}</span>
          ) : null}
          {task.nextBooking ? <Booked booking={task.nextBooking} className="shrink-0" /> : null}
        </span>
      </span>

      <span className="flex items-center gap-0.5">
        <DueMenu dueOn={task.dueOn} status={task.status} onChange={(dueOn) => onChange(task, { dueOn })} />
        <AssigneeMenu
          assigneeId={task.assigneeId}
          team={people.team}
          me={people.me}
          colorOf={people.colorOf}
          onChange={(assigneeId) => onChange(task, { assigneeId })}
        />
      </span>
    </li>
  );
}

function groupTasks(tasks: TaskView[], groupBy: GroupBy, people: PanelPeople): Group[] {
  // Inside a group: open before finished, then the board's own order — so
  // a card moved up the board is up the list too.
  const sorted = [...tasks].sort(
    (a, b) => statusOrder(a.status) - statusOrder(b.status) || a.position - b.position
  );

  if (groupBy === "status") {
    return TASK_STATUSES.map(({ status, label }) => ({
      key: `status:${status}`,
      label,
      icon: <StatusIcon status={status} />,
      tasks: sorted.filter((task) => task.status === status),
      defaults: { status },
    })).filter((group) => group.tasks.length > 0 || group.key !== "status:cancelled");
  }

  if (groupBy === "person") {
    const whose = new Map<string | null, TaskView[]>();
    for (const task of sorted) whose.set(task.assigneeId, [...(whose.get(task.assigneeId) ?? []), task]);
    const order = [people.me, ...people.team.map((m) => m.userId).filter((id) => id !== people.me)];
    const groups: Group[] = order
      .filter((id) => whose.has(id))
      .map((id) => {
        const member = people.team.find((m) => m.userId === id)!;
        return {
          key: `person:${id}`,
          label: id === people.me ? `${member.name} (you)` : member.name,
          icon: <PersonAvatar member={member} swatch={people.colorOf(id)} />,
          tasks: whose.get(id)!,
          defaults: { assigneeId: id },
        };
      });
    // Someone who has left the team still has their tasks shown.
    for (const [id, list] of whose) {
      if (id && !order.includes(id)) {
        groups.push({ key: `person:${id}`, label: "Someone no longer on the team", icon: <PersonAvatar member={null} />, tasks: list, defaults: {} });
      }
    }
    if (whose.has(null)) {
      groups.push({ key: "person:none", label: "Nobody yet", icon: <PersonAvatar member={null} />, tasks: whose.get(null)!, defaults: { assigneeId: null } });
    }
    return groups;
  }

  // By job — the project view.
  const byJob = new Map<string, { job: ScheduleJob | null; tasks: TaskView[] }>();
  for (const task of sorted) {
    const key = task.job?.id ?? "none";
    const entry = byJob.get(key) ?? { job: task.job, tasks: [] };
    entry.tasks.push(task);
    byJob.set(key, entry);
  }
  const groups = [...byJob.entries()]
    .filter(([key]) => key !== "none")
    .sort((a, b) => (b[1].job?.number ?? 0) - (a[1].job?.number ?? 0))
    .map(([key, { job, tasks: list }]) => ({
      key: `job:${key}`,
      label: jobLabel(job!),
      icon: <span className="text-muted-foreground text-xs tabular-nums">#{job!.number}</span>,
      tasks: list,
      defaults: { job },
      progress: {
        done: list.filter((task) => task.status === "done").length,
        total: list.filter((task) => task.status !== "cancelled").length,
      },
    }));
  const shop = byJob.get("none");
  if (shop) {
    groups.push({
      key: "job:none",
      label: "The shop's",
      icon: <span className="text-muted-foreground text-xs">—</span>,
      tasks: shop.tasks,
      defaults: { job: null },
      progress: {
        done: shop.tasks.filter((task) => task.status === "done").length,
        total: shop.tasks.filter((task) => task.status !== "cancelled").length,
      },
    });
  }
  return groups;
}

function statusOrder(status: TaskStatus) {
  return TASK_STATUSES.findIndex((entry) => entry.status === status);
}
