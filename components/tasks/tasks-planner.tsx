"use client";

import { useEffect, useMemo, useState } from "react";
import { Check, Loader2, Plus, Search, Tags, UserRound, X } from "lucide-react";
import { toast } from "sonner";

import { JobPicker } from "@/components/jobs/job-picker";
import { swatches, UNASSIGNED } from "@/components/schedule/colors";
import { TagBadges } from "@/components/tags/tag-controls";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import type { ScheduleJob, TeamMember } from "@/lib/schedule/types";
import type { Tag } from "@/lib/tags";
import { isClosed, type TaskStatus, type TaskView } from "@/lib/tasks/types";
import { cn } from "@/lib/utils";

import { TaskBoard } from "./task-board";
import { TaskList, type GroupBy } from "./task-list";
import { TaskPanel, type PanelPeople, type TaskDraftDefaults } from "./task-panel";
import { useTaskMutations, useTasks, type TaskChange } from "./use-tasks";

/**
 * TASKS — the page.
 *
 * **Two views of one set of tasks.** The list is for reading and triage, the
 * board for moving work along; switching between them keeps every filter,
 * because they are the same question laid out two ways.
 *
 * **Filters are the questions a contractor asks**: what's mine, what's on the
 * Petersen job, what's tagged warranty. Each is in the address, so a link to
 * "my tasks on this job" is just a link.
 */

export type TasksView = "list" | "board";

type Open =
  | { kind: "task"; id: string; initial?: TaskView }
  | { kind: "new"; defaults: TaskDraftDefaults }
  | null;

const VIEWS: { view: TasksView; label: string }[] = [
  { view: "list", label: "List" },
  { view: "board", label: "Board" },
];

const GROUPS: { group: GroupBy; label: string }[] = [
  { group: "status", label: "Status" },
  { group: "job", label: "Job" },
  { group: "person", label: "Person" },
];

export function TasksPlanner({
  team,
  me,
  organizationId,
  tags,
  initial,
}: {
  team: TeamMember[];
  me: string;
  organizationId: string;
  tags: Tag[];
  initial: {
    view: TasksView | null;
    group: GroupBy | null;
    taskId: string | null;
    job: ScheduleJob | null;
    assignee: string | null;
    q: string | null;
    tagIds: string[];
  };
}) {
  const [view, setView] = useState<TasksView>(initial.view ?? "list");
  const [group, setGroup] = useState<GroupBy>(initial.group ?? "status");
  const [job, setJob] = useState<ScheduleJob | null>(initial.job);
  const [assignee, setAssignee] = useState<string | null>(initial.assignee);
  const [tagIds, setTagIds] = useState<string[]>(initial.tagIds);
  const [typed, setTyped] = useState(initial.q ?? "");
  const [q, setQ] = useState(initial.q ?? "");
  const [open, setOpen] = useState<Open>(initial.taskId ? { kind: "task", id: initial.taskId } : null);

  // Typing settles before it asks.
  useEffect(() => {
    const timer = setTimeout(() => setQ(typed.trim()), 250);
    return () => clearTimeout(timer);
  }, [typed]);

  const colors = useMemo(() => swatches(team.map((member) => member.userId)), [team]);
  const people: PanelPeople = {
    team,
    me,
    colorOf: (userId: string) => colors.get(userId) ?? UNASSIGNED,
  };

  const filter = {
    job: job?.id,
    assignee: assignee ?? undefined,
    q: q || undefined,
    tags: tagIds.length ? tagIds.join(",") : undefined,
  };
  const tasks = useTasks(filter);
  const { update } = useTaskMutations();
  const all = tasks.data ?? [];
  const filtered = Boolean(job || assignee || q || tagIds.length);

  /* ── The address follows the page ─────────────────────────────────── */

  useEffect(() => {
    const params = new URLSearchParams();
    if (view !== "list") params.set("view", view);
    if (group !== "status") params.set("group", group);
    if (job) params.set("job", job.id);
    if (assignee) params.set("assignee", assignee === me ? "me" : assignee);
    if (tagIds.length) params.set("tags", tagIds.join(","));
    if (q) params.set("q", q);
    if (open?.kind === "task") params.set("task", open.id);
    const next = `/tasks${params.size ? `?${params}` : ""}`;
    if (next !== `${window.location.pathname}${window.location.search}`) {
      window.history.replaceState(null, "", next);
    }
  }, [view, group, job, assignee, tagIds, q, open, me]);

  /* ── Keys ─────────────────────────────────────────────────────────── */

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement;
      if (
        event.metaKey ||
        event.ctrlKey ||
        event.altKey ||
        open ||
        target.closest("input, textarea, select, [contenteditable], [role=dialog], [role=menu]")
      ) {
        return;
      }
      if (event.key === "c") {
        event.preventDefault();
        setOpen({ kind: "new", defaults: defaultsHere() });
      } else if (event.key === "/") {
        event.preventDefault();
        document.getElementById("task-search")?.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  /** A task started here takes what "here" is: this job, this person. */
  function defaultsHere(extra: TaskDraftDefaults = {}): TaskDraftDefaults {
    return {
      job,
      assigneeId: assignee && assignee !== "none" ? assignee : null,
      ...extra,
    };
  }

  function change(task: TaskView, next: TaskChange) {
    update.mutate(
      { id: task.id, change: next },
      {
        onSuccess: () => {
          if (next.status && isClosed(next.status) && !isClosed(task.status)) {
            toast.success(next.status === "done" ? `Done: ${task.title}` : `Cancelled: ${task.title}`, {
              action: { label: "Undo", onClick: () => change({ ...task, status: next.status! }, { status: task.status, position: task.position }) },
            });
          }
        },
        onError: (error) => toast.error(error.message),
      }
    );
  }

  const openCount = all.filter((task) => !isClosed(task.status)).length;

  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* Toolbar. */}
      <div className="flex flex-wrap items-center gap-2 border-b px-4 py-2.5 md:px-5">
        <h1 className="text-lg font-semibold tracking-tight">Tasks</h1>
        <span className="text-muted-foreground text-sm tabular-nums">{openCount} open</span>
        {tasks.isFetching ? <Loader2 className="text-muted-foreground size-4 animate-spin" aria-label="Loading" /> : null}

        <div className="order-last flex w-full flex-wrap items-center gap-2 lg:order-none lg:ml-auto lg:w-auto">
          <div className="relative min-w-40 flex-1 basis-full sm:basis-auto lg:w-56 lg:flex-none">
            <Search className="text-muted-foreground pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2" />
            <Input
              id="task-search"
              type="search"
              aria-label="Search tasks"
              placeholder="Search tasks"
              value={typed}
              onChange={(event) => setTyped(event.target.value)}
              className="h-8 pl-8"
            />
          </div>
          <PersonFilter value={assignee} team={team} me={me} people={people} onChange={setAssignee} />
          <div className="min-w-0 flex-1 sm:w-auto sm:min-w-44 sm:flex-none">
            <JobPicker
              value={job}
              onChange={setJob}
              clearable
              emptyLabel="All jobs"
              clearLabel="All jobs"
              className="h-8 min-h-8 w-full py-1 text-sm"
            />
          </div>
          {tags.length ? <TagFilter tags={tags} value={tagIds} onChange={setTagIds} /> : null}
          {view === "list" ? (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" size="sm">
                  Group: {GROUPS.find((entry) => entry.group === group)!.label}
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                {GROUPS.map((entry) => (
                  <DropdownMenuItem key={entry.group} onSelect={() => setGroup(entry.group)}>
                    {entry.label}
                    {entry.group === group ? <Check className="ml-auto size-4" /> : null}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          ) : null}
        </div>

        <div className="ml-auto flex items-center gap-2 lg:ml-0">
          <div className="bg-muted flex rounded-lg p-0.5" role="group" aria-label="View">
            {VIEWS.map((entry) => (
              <button
                key={entry.view}
                type="button"
                aria-pressed={view === entry.view}
                onClick={() => setView(entry.view)}
                className={cn(
                  "rounded-md px-3 py-1 text-sm transition-colors",
                  view === entry.view ? "bg-background font-medium shadow-sm" : "text-muted-foreground hover:text-foreground"
                )}
              >
                {entry.label}
              </button>
            ))}
          </div>
          <Button size="sm" onClick={() => setOpen({ kind: "new", defaults: defaultsHere() })} title="New task (C)">
            <Plus className="size-4" />
            New task
          </Button>
        </div>
      </div>

      {/* The tasks. */}
      <div className={cn("min-h-0 flex-1", view === "board" ? "overflow-hidden pt-4" : "overflow-y-auto")}>
        {tasks.isError ? (
          <div className="flex flex-col items-start gap-3 p-6">
            <p className="text-sm">{tasks.error.message}</p>
            <Button variant="outline" size="sm" onClick={() => tasks.refetch()}>
              Try again
            </Button>
          </div>
        ) : tasks.isPending ? (
          <p className="text-muted-foreground flex items-center gap-2 p-6 text-sm">
            <Loader2 className="size-4 animate-spin" /> Loading the tasks…
          </p>
        ) : all.length === 0 && !filtered ? (
          <div className="mx-auto flex max-w-md flex-col items-center gap-3 px-6 py-16 text-center">
            <p className="text-base font-medium">No tasks yet</p>
            <p className="text-muted-foreground text-sm">
              A thing to order, a call to make, a fix to come back for — put it on a job, give it to
              someone, and give it a day.
            </p>
            <Button onClick={() => setOpen({ kind: "new", defaults: defaultsHere() })}>
              <Plus className="size-4" />
              Add the first task
            </Button>
          </div>
        ) : all.length === 0 ? (
          <div className="flex flex-col items-start gap-3 p-6">
            <p className="text-muted-foreground text-sm">No task matches these filters.</p>
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                setJob(null);
                setAssignee(null);
                setTagIds([]);
                setTyped("");
              }}
            >
              Clear the filters
            </Button>
          </div>
        ) : view === "board" ? (
          <TaskBoard
            tasks={all}
            people={people}
            onOpen={(task) => setOpen({ kind: "task", id: task.id, initial: task })}
            onChange={change}
            onAdd={(status: TaskStatus) => setOpen({ kind: "new", defaults: defaultsHere({ status }) })}
          />
        ) : (
          <TaskList
            tasks={all}
            groupBy={group}
            people={people}
            onOpen={(task) => setOpen({ kind: "task", id: task.id, initial: task })}
            onChange={change}
            onAdd={(defaults) => setOpen({ kind: "new", defaults: defaultsHere(defaults) })}
          />
        )}
      </div>

      {open ? (
        <TaskPanel
          taskId={open.kind === "task" ? open.id : undefined}
          initial={open.kind === "task" ? (open.initial ?? all.find((task) => task.id === open.id)) : undefined}
          defaults={open.kind === "new" ? open.defaults : undefined}
          people={people}
          organizationId={organizationId}
          tags={tags}
          onClose={() => setOpen(null)}
        />
      ) : null}
    </div>
  );
}

function PersonFilter({
  value,
  team,
  me,
  people,
  onChange,
}: {
  value: string | null;
  team: TeamMember[];
  me: string;
  people: PanelPeople;
  onChange: (value: string | null) => void;
}) {
  const member = team.find((person) => person.userId === value);
  const label = value === null ? "Everyone" : value === me ? "Mine" : value === "none" ? "Nobody yet" : (member?.name ?? "Someone");
  const choices: [string | null, string][] = [
    [null, "Everyone"],
    [me, "Mine"],
    ["none", "Nobody yet"],
  ];

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size="sm" className={cn(value && "border-primary/60")}>
          <UserRound className="size-4" />
          {label}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-56">
        {choices.map(([choice, text]) => (
          <DropdownMenuItem key={text} onSelect={() => onChange(choice)}>
            {text}
            {value === choice ? <Check className="ml-auto size-4" /> : null}
          </DropdownMenuItem>
        ))}
        {team.length > 1 ? (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuLabel className="text-muted-foreground text-xs font-normal">Someone else</DropdownMenuLabel>
            {team
              .filter((person) => person.userId !== me)
              .map((person) => (
                <DropdownMenuItem key={person.userId} onSelect={() => onChange(person.userId)}>
                  <span className={cn("size-2 rounded-full", people.colorOf(person.userId).dot)} />
                  <span className="truncate">{person.name}</span>
                  {value === person.userId ? <Check className="ml-auto size-4" /> : null}
                </DropdownMenuItem>
              ))}
          </>
        ) : null}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function TagFilter({
  tags,
  value,
  onChange,
}: {
  tags: Tag[];
  value: string[];
  onChange: (value: string[]) => void;
}) {
  const chosen = tags.filter((tag) => value.includes(tag.id));
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size="sm" className={cn(value.length && "border-primary/60")}>
          <Tags className="size-4" />
          {chosen.length ? <TagBadges tags={chosen.slice(0, 2)} /> : "Tags"}
          {chosen.length > 2 ? <span className="text-muted-foreground text-xs">+{chosen.length - 2}</span> : null}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-56">
        <DropdownMenuLabel className="text-muted-foreground text-xs font-normal">Any of these tags</DropdownMenuLabel>
        {tags.map((tag) => (
          <DropdownMenuCheckboxItem
            key={tag.id}
            checked={value.includes(tag.id)}
            onSelect={(event) => event.preventDefault()}
            onCheckedChange={(checked) =>
              onChange(checked ? [...value, tag.id] : value.filter((id) => id !== tag.id))
            }
          >
            <TagBadges tags={[tag]} />
          </DropdownMenuCheckboxItem>
        ))}
        {value.length ? (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={() => onChange([])}>
              <X className="size-4" />
              Clear
            </DropdownMenuItem>
          </>
        ) : null}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
