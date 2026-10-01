"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { ChevronRight, Loader2, Plus } from "lucide-react";
import { toast } from "sonner";

import { swatches, UNASSIGNED } from "@/components/schedule/colors";
import { Input } from "@/components/ui/input";
import type { ScheduleJob, TeamMember } from "@/lib/schedule/types";
import type { Tag } from "@/lib/tags";
import { isClosed, type TaskView } from "@/lib/tasks/types";
import { cn } from "@/lib/utils";

import { AssigneeMenu, DueMenu, StatusMenu } from "./task-menus";
import { TaskPanel, type PanelPeople } from "./task-panel";
import { useTaskMutations, useTasks, type TaskChange } from "./use-tasks";

/**
 * A job's tasks, on the job — the project view of one project.
 *
 * **Adding one is typing a line and pressing Enter**, because on a job page a
 * task is usually a thought you want out of your head before it's gone: "order
 * the 200A panel". Everything else about it can wait for the task itself.
 *
 * Finished ones fold away under a count, so the panel is what's still to do.
 */
export function JobTasks({
  job,
  team,
  me,
  organizationId,
  tags,
  className,
  heading,
}: {
  job: ScheduleJob;
  team: TeamMember[];
  me: string;
  organizationId: string;
  tags: Tag[];
  className?: string;
  heading: React.ReactNode;
}) {
  const tasks = useTasks({ job: job.id });
  const { create, update } = useTaskMutations();
  const [line, setLine] = useState("");
  const [showDone, setShowDone] = useState(false);
  const [open, setOpen] = useState<TaskView | null>(null);

  const colors = useMemo(() => swatches(team.map((member) => member.userId)), [team]);
  const people: PanelPeople = { team, me, colorOf: (id) => colors.get(id) ?? UNASSIGNED };

  const all = tasks.data ?? [];
  const todo = all.filter((task) => !isClosed(task.status));
  const done = all.filter((task) => task.status === "done");
  const counted = all.filter((task) => task.status !== "cancelled").length;

  function add() {
    const title = line.trim();
    if (!title || create.isPending) return;
    create.mutate(
      { title, jobId: job.id },
      {
        onSuccess: () => setLine(""),
        onError: (error) => toast.error(error.message),
      }
    );
  }

  function change(task: TaskView, next: TaskChange) {
    update.mutate({ id: task.id, change: next }, { onError: (error) => toast.error(error.message) });
  }

  return (
    <section className={className}>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        {heading}
        <Link
          href={`/tasks?job=${job.id}&view=board`}
          className="text-muted-foreground hover:text-foreground text-xs underline underline-offset-4"
        >
          Open the board
        </Link>
      </div>
      {counted > 0 ? (
        <div className="text-muted-foreground mt-2 flex items-center gap-2 text-xs">
          <span className="bg-muted relative h-1.5 flex-1 overflow-hidden rounded-full">
            <span
              className="absolute inset-y-0 left-0 rounded-full bg-emerald-500 transition-[width]"
              style={{ width: `${(done.length / counted) * 100}%` }}
            />
          </span>
          {done.length} of {counted} done
        </div>
      ) : null}

      <form
        className="mt-3 flex items-center gap-2 border-t pt-3"
        onSubmit={(event) => {
          event.preventDefault();
          add();
        }}
      >
        <Plus className="text-muted-foreground size-4 shrink-0" />
        <Input
          aria-label="Add a task to this job"
          placeholder="Add a task"
          value={line}
          maxLength={200}
          onChange={(event) => setLine(event.target.value)}
          className="h-8 border-0 px-1 shadow-none focus-visible:ring-0 dark:bg-transparent"
        />
        {create.isPending ? <Loader2 className="text-muted-foreground size-4 animate-spin" /> : null}
      </form>

      {tasks.isPending ? (
        <p className="text-muted-foreground border-t py-3 text-sm">Loading…</p>
      ) : todo.length === 0 && done.length === 0 ? (
        <p className="text-muted-foreground border-t py-3 text-sm">Nothing to do on this job yet.</p>
      ) : (
        <ul className="border-t">
          {todo.map((task) => (
            <Line key={task.id} task={task} people={people} onOpen={setOpen} onChange={change} />
          ))}
          {todo.length === 0 ? (
            <li className="text-muted-foreground py-3 text-sm">All done.</li>
          ) : null}
        </ul>
      )}

      {done.length ? (
        <div className="border-t">
          <button
            type="button"
            className="text-muted-foreground hover:text-foreground flex items-center gap-1 py-2 text-xs"
            aria-expanded={showDone}
            onClick={() => setShowDone((shown) => !shown)}
          >
            <ChevronRight className={cn("size-3.5 transition-transform", showDone && "rotate-90")} />
            {done.length} done
          </button>
          {showDone ? (
            <ul>
              {done.map((task) => (
                <Line key={task.id} task={task} people={people} onOpen={setOpen} onChange={change} />
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}

      {open ? (
        <TaskPanel
          taskId={open.id}
          initial={open}
          people={people}
          organizationId={organizationId}
          tags={tags}
          onClose={() => setOpen(null)}
        />
      ) : null}
    </section>
  );
}

function Line({
  task,
  people,
  onOpen,
  onChange,
}: {
  task: TaskView;
  people: PanelPeople;
  onOpen: (task: TaskView) => void;
  onChange: (task: TaskView, change: TaskChange) => void;
}) {
  return (
    <li
      role="button"
      tabIndex={0}
      onClick={() => onOpen(task)}
      onKeyDown={(event) => {
        if (event.key === "Enter") onOpen(task);
      }}
      className="hover:bg-muted/40 -mx-2 flex cursor-pointer items-center gap-1.5 rounded-md px-2 py-1.5 outline-none focus-visible:bg-muted/60"
    >
      <StatusMenu status={task.status} onChange={(status) => onChange(task, { status })} />
      <span
        className={cn(
          "min-w-0 flex-1 truncate text-sm",
          task.status === "done" && "text-muted-foreground line-through decoration-muted-foreground/50"
        )}
      >
        {task.title}
      </span>
      {task.dueOn ? (
        <DueMenu dueOn={task.dueOn} status={task.status} onChange={(dueOn) => onChange(task, { dueOn })} />
      ) : null}
      <AssigneeMenu
        assigneeId={task.assigneeId}
        team={people.team}
        me={people.me}
        colorOf={people.colorOf}
        onChange={(assigneeId) => onChange(task, { assigneeId })}
      />
    </li>
  );
}
