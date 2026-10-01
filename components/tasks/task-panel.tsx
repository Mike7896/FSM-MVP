"use client";

import { useState } from "react";
import Link from "next/link";
import { CalendarPlus, Loader2, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { JobPicker, jobLabel } from "@/components/jobs/job-picker";
import {
  ResponsiveDialog,
  ResponsiveDialogBody,
  ResponsiveDialogContent,
  ResponsiveDialogFooter,
  ResponsiveDialogHeader,
} from "@/components/responsive-dialog";
import type { Swatch } from "@/components/schedule/colors";
import { RecordTags } from "@/components/tags/tag-controls";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { fromISODate, timeRangeLabel } from "@/lib/schedule/dates";
import type { ScheduleJob, TeamMember } from "@/lib/schedule/types";
import type { Tag } from "@/lib/tags";
import { taskKey, type TaskDetail, type TaskPriority, type TaskStatus, type TaskView } from "@/lib/tasks/types";
import { cn } from "@/lib/utils";

import { AssigneeMenu, DueMenu, PriorityMenu, StatusMenu } from "./task-menus";
import { useTask, useTaskMutations, type TaskChange } from "./use-tasks";

/**
 * One task, opened — or a new one being written.
 *
 * **Everything saves as it's changed**, the way Linear's issue view does: pick
 * a status and it's that status; the title and notes save when you leave them.
 * There is no Save button to forget, so closing the panel never loses a thing.
 *
 * **It's where a task meets the schedule.** "Book time" opens the schedule
 * with a visit already filled in from the task — its job, its title, its
 * person — and every visit booked that way is listed here.
 */

export type PanelPeople = {
  team: TeamMember[];
  me: string;
  colorOf: (userId: string) => Swatch;
};

export type TaskDraftDefaults = {
  status?: TaskStatus;
  job?: ScheduleJob | null;
  assigneeId?: string | null;
};

export function TaskPanel({
  taskId,
  initial,
  defaults,
  people,
  organizationId,
  tags,
  onClose,
  onCreated,
}: {
  /** Opening this task; left out, writing a new one. */
  taskId?: string;
  /** What the list already knows about it, so it opens without a wait. */
  initial?: TaskView;
  /** For a new one: what the place it was started from implies. */
  defaults?: TaskDraftDefaults;
  people: PanelPeople;
  organizationId: string;
  tags: Tag[];
  onClose: () => void;
  onCreated?: (task: TaskView) => void;
}) {
  return (
    <ResponsiveDialog open onOpenChange={(open) => !open && onClose()}>
      <ResponsiveDialogContent
        desktopClassName="sm:max-w-3xl"
        // Opening a task is for reading it; only a new one starts in the title.
        onOpenAutoFocus={taskId ? (event) => event.preventDefault() : undefined}
      >
        {taskId ? (
          <OpenTask
            taskId={taskId}
            initial={initial}
            people={people}
            organizationId={organizationId}
            tags={tags}
            onClose={onClose}
          />
        ) : (
          <NewTaskForm defaults={defaults} people={people} onClose={onClose} onCreated={onCreated} />
        )}
      </ResponsiveDialogContent>
    </ResponsiveDialog>
  );
}

/* ── A new one ────────────────────────────────────────────────────────── */

function NewTaskForm({
  defaults,
  people,
  onClose,
  onCreated,
}: {
  defaults?: TaskDraftDefaults;
  people: PanelPeople;
  onClose: () => void;
  onCreated?: (task: TaskView) => void;
}) {
  const { create } = useTaskMutations();
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [status, setStatus] = useState<TaskStatus>(defaults?.status ?? "todo");
  const [priority, setPriority] = useState<TaskPriority>("none");
  const [assigneeId, setAssigneeId] = useState<string | null>(defaults?.assigneeId ?? null);
  const [job, setJob] = useState<ScheduleJob | null>(defaults?.job ?? null);
  const [dueOn, setDueOn] = useState<string | null>(null);

  function save() {
    if (!title.trim() || create.isPending) return;
    create.mutate(
      {
        title: title.trim(),
        description: description.trim() || null,
        status,
        priority,
        assigneeId,
        jobId: job?.id ?? null,
        dueOn,
      },
      {
        onSuccess: (task) => {
          toast.success(`${taskKey(task.number)} added.`);
          onCreated?.(task);
          onClose();
        },
        onError: (error) => toast.error(error.message),
      }
    );
  }

  return (
    <>
      <ResponsiveDialogHeader title="New task" />
      <ResponsiveDialogBody className="grid gap-6 md:grid-cols-[minmax(0,1fr)_15rem]">
        <div className="flex min-w-0 flex-col gap-3">
          <Input
            autoFocus
            aria-label="Title"
            placeholder="What needs doing"
            value={title}
            maxLength={200}
            className="h-11 text-base font-medium md:text-lg"
            onChange={(event) => setTitle(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && (event.metaKey || event.ctrlKey || !event.shiftKey)) {
                event.preventDefault();
                save();
              }
            }}
          />
          <Textarea
            aria-label="Notes"
            placeholder="Notes"
            rows={6}
            className="min-h-32 resize-y"
            value={description}
            maxLength={10_000}
            onChange={(event) => setDescription(event.target.value)}
          />
        </div>

        <Properties>
          <Property label="Status">
            <StatusMenu status={status} onChange={setStatus} withLabel className="w-full justify-start px-2" />
          </Property>
          <Property label="Priority">
            <PriorityMenu priority={priority} onChange={setPriority} withLabel className="w-full justify-start px-2" />
          </Property>
          <Property label="Whose">
            <AssigneeMenu
              assigneeId={assigneeId}
              team={people.team}
              me={people.me}
              colorOf={people.colorOf}
              onChange={setAssigneeId}
              withLabel
              className="w-full justify-start px-2"
            />
          </Property>
          <Property label="Due">
            <DueMenu dueOn={dueOn} status={status} onChange={setDueOn} withLabel className="w-full justify-start px-2" />
          </Property>
          <Property label="Job">
            <JobPicker value={job} onChange={setJob} clearable className="w-full" />
          </Property>
        </Properties>
      </ResponsiveDialogBody>
      <ResponsiveDialogFooter className="flex items-center justify-end gap-2">
        <Button type="button" variant="outline" onClick={onClose} disabled={create.isPending}>
          Cancel
        </Button>
        <Button type="button" onClick={save} disabled={!title.trim() || create.isPending}>
          {create.isPending ? <Loader2 className="animate-spin" /> : null}
          Add task
        </Button>
      </ResponsiveDialogFooter>
    </>
  );
}

/* ── An existing one ──────────────────────────────────────────────────── */

function OpenTask({
  taskId,
  initial,
  people,
  organizationId,
  tags,
  onClose,
}: {
  taskId: string;
  initial?: TaskView;
  people: PanelPeople;
  organizationId: string;
  tags: Tag[];
  onClose: () => void;
}) {
  const detail = useTask(taskId);
  const task: TaskView | TaskDetail | undefined = detail.data ?? initial;

  if (!task) {
    return (
      <>
        <ResponsiveDialogHeader title="Task" />
        <ResponsiveDialogBody>
          {detail.isError ? (
            <p className="text-muted-foreground py-6 text-sm">{detail.error.message}</p>
          ) : (
            <p className="text-muted-foreground flex items-center gap-2 py-6 text-sm">
              <Loader2 className="size-4 animate-spin" /> Opening it…
            </p>
          )}
        </ResponsiveDialogBody>
      </>
    );
  }

  return (
    <TaskEditor
      key={task.id}
      task={task}
      detail={detail.data}
      people={people}
      organizationId={organizationId}
      tags={tags}
      onClose={onClose}
    />
  );
}

function TaskEditor({
  task,
  detail,
  people,
  organizationId,
  tags,
  onClose,
}: {
  task: TaskView;
  detail: TaskDetail | undefined;
  people: PanelPeople;
  organizationId: string;
  tags: Tag[];
  onClose: () => void;
}) {
  const { update, remove, create } = useTaskMutations();
  const [title, setTitle] = useState(task.title);
  const [description, setDescription] = useState(task.description ?? "");

  function change(next: TaskChange, said?: string) {
    update.mutate(
      { id: task.id, change: next },
      {
        onSuccess: () => (said ? toast.success(said) : undefined),
        onError: (error) => toast.error(error.message),
      }
    );
  }

  function saveTitle() {
    const next = title.trim();
    if (!next) {
      setTitle(task.title);
      return;
    }
    if (next !== task.title) change({ title: next });
  }

  function saveDescription() {
    const next = description.trim();
    if (next !== (task.description ?? "")) change({ description: next || null });
  }

  function discard() {
    onClose();
    remove.mutate(task.id, {
      onSuccess: () =>
        toast.success(`${taskKey(task.number)} deleted.`, {
          duration: 10_000,
          action: {
            label: "Undo",
            onClick: () =>
              create.mutate(
                {
                  title: task.title,
                  description: task.description,
                  status: task.status,
                  priority: task.priority,
                  assigneeId: task.assigneeId,
                  jobId: task.job?.id ?? null,
                  dueOn: task.dueOn,
                  position: task.position,
                },
                {
                  onSuccess: () => toast.success("Put back."),
                  onError: (error) => toast.error(error.message),
                }
              ),
          },
        }),
      onError: (error) => toast.error(error.message),
    });
  }

  const booked = detail?.visits ?? [];

  return (
    <>
      <ResponsiveDialogHeader
        title={
          <span className="flex min-w-0 items-center gap-2">
            <span className="text-muted-foreground font-normal tabular-nums">{taskKey(task.number)}</span>
            {task.job ? (
              <Link
                href={`/jobs/${task.job.id}`}
                className="text-muted-foreground hover:text-foreground truncate text-sm font-normal hover:underline"
              >
                {jobLabel(task.job)}
              </Link>
            ) : (
              <span className="text-muted-foreground text-sm font-normal">The shop&apos;s</span>
            )}
          </span>
        }
      />
      <ResponsiveDialogBody className="grid gap-6 md:grid-cols-[minmax(0,1fr)_15rem]">
        <div className="flex min-w-0 flex-col gap-3">
          <Input
            aria-label="Title"
            value={title}
            maxLength={200}
            className="h-11 text-base font-medium md:text-lg"
            onChange={(event) => setTitle(event.target.value)}
            onBlur={saveTitle}
            onKeyDown={(event) => {
              if (event.key === "Enter") event.currentTarget.blur();
              if (event.key === "Escape") setTitle(task.title);
            }}
          />
          <Textarea
            aria-label="Notes"
            placeholder="Notes"
            rows={6}
            className="min-h-32 resize-y"
            value={description}
            maxLength={10_000}
            onChange={(event) => setDescription(event.target.value)}
            onBlur={saveDescription}
          />

          <RecordTags
            organizationId={organizationId}
            entity="task"
            recordId={task.id}
            available={tags}
            selected={task.tags}
          />

          {/* On the schedule. */}
          <section className="mt-2 flex flex-col gap-2">
            <div className="flex items-center justify-between gap-2">
              <h3 className="text-muted-foreground text-xs font-medium">On the schedule</h3>
              <Button asChild variant="outline" size="sm">
                <Link href={`/schedule?book=${task.id}`}>
                  <CalendarPlus className="size-4" />
                  Book time
                </Link>
              </Button>
            </div>
            {booked.length ? (
              <ul className="flex flex-col rounded-lg border">
                {booked.map((visit, index) => (
                  <li key={visit.id} className={cn(index > 0 && "border-t")}>
                    <Link
                      href={`/schedule?view=day&date=${visit.startsOn ?? localDate(visit.startsAt!)}&visit=${visit.id}`}
                      className={cn(
                        "hover:bg-muted/50 flex items-baseline justify-between gap-3 px-3 py-2 text-sm",
                        visit.status === "cancelled" && "text-muted-foreground line-through"
                      )}
                    >
                      <span className="truncate">{visit.title}</span>
                      <span className="text-muted-foreground shrink-0 text-xs">
                        {whenOf(visit)}
                        {visit.status === "done" ? " · done" : ""}
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-muted-foreground text-sm">
                {detail ? "No time booked for it yet." : "Looking…"}
              </p>
            )}
          </section>
        </div>

        <Properties>
          <Property label="Status">
            <StatusMenu
              status={task.status}
              onChange={(status) => change({ status })}
              withLabel
              className="w-full justify-start px-2"
            />
          </Property>
          <Property label="Priority">
            <PriorityMenu
              priority={task.priority}
              onChange={(priority) => change({ priority })}
              withLabel
              className="w-full justify-start px-2"
            />
          </Property>
          <Property label="Whose">
            <AssigneeMenu
              assigneeId={task.assigneeId}
              team={people.team}
              me={people.me}
              colorOf={people.colorOf}
              onChange={(assigneeId) => change({ assigneeId })}
              withLabel
              className="w-full justify-start px-2"
            />
          </Property>
          <Property label="Due">
            <DueMenu
              dueOn={task.dueOn}
              status={task.status}
              onChange={(dueOn) => change({ dueOn })}
              withLabel
              className="w-full justify-start px-2"
            />
          </Property>
          <Property label="Job">
            <JobPicker
              value={task.job}
              onChange={(job) => change({ jobId: job?.id ?? null }, job ? `Moved to ${jobLabel(job)}.` : "It's the shop's now.")}
              clearable
              className="w-full"
            />
          </Property>
          <p className="text-muted-foreground mt-2 text-xs leading-relaxed">
            Added {new Date(task.createdAt).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}
            {detail?.createdByName ? ` by ${detail.createdByName}` : ""}
            {task.completedAt
              ? ` · done ${new Date(task.completedAt).toLocaleDateString("en-US", { month: "short", day: "numeric" })}`
              : ""}
          </p>
        </Properties>
      </ResponsiveDialogBody>
      <ResponsiveDialogFooter className="flex items-center justify-between gap-2">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="text-muted-foreground hover:text-destructive"
          onClick={discard}
        >
          <Trash2 className="size-4" />
          Delete
        </Button>
        <Button type="button" variant="outline" onClick={onClose}>
          Close
        </Button>
      </ResponsiveDialogFooter>
    </>
  );
}

/* ── Pieces ───────────────────────────────────────────────────────────── */

function Properties({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1 md:border-l md:pl-4">
      {children}
    </div>
  );
}

function Property({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[4.5rem_minmax(0,1fr)] items-center gap-2 md:grid-cols-1 md:gap-0.5">
      <Label className="text-muted-foreground text-xs font-normal">{label}</Label>
      <div className="min-w-0">{children}</div>
    </div>
  );
}

function whenOf(visit: TaskDetail["visits"][number]) {
  if (visit.allDay) {
    const day = (iso: string) =>
      fromISODate(iso).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
    return visit.startsOn === visit.endsOn ? day(visit.startsOn!) : `${day(visit.startsOn!)} – ${day(visit.endsOn!)}`;
  }
  const start = new Date(visit.startsAt!);
  return `${start.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" })} · ${timeRangeLabel(start, new Date(visit.endsAt!))}`;
}

function localDate(instant: string) {
  const date = new Date(instant);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}
