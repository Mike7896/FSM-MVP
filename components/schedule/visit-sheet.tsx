"use client";

import { useState } from "react";
import { ListTodo, Loader2, Trash2, X } from "lucide-react";

import {
  ResponsiveDialog,
  ResponsiveDialogBody,
  ResponsiveDialogContent,
  ResponsiveDialogFooter,
  ResponsiveDialogHeader,
} from "@/components/responsive-dialog";
import { Button } from "@/components/ui/button";
import { JobPicker, jobLabel } from "@/components/jobs/job-picker";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import {
  atMinutes,
  fromISODate,
  minutesOfDay,
  timeLabel,
  toISODate,
} from "@/lib/schedule/dates";
import {
  VISIT_KINDS,
  visitKind,
  type ScheduleJob,
  type ScheduleVisit,
  type TeamMember,
  type VisitKind,
  type VisitStatus,
} from "@/lib/schedule/types";
import { cn } from "@/lib/utils";

import type { Swatch } from "./colors";
import type { VisitDraft } from "./use-schedule";

export { jobLabel };

/**
 * Booking a visit, or changing one — the whole of it in one sheet.
 *
 * **It opens already filled in** with whatever was drawn or clicked: drag 8 to
 * 11 on Tuesday and the sheet says Tuesday, 8 to 11. Most bookings are then a
 * job and a person away from done.
 *
 * **The job is picked, never typed.** A visit on a job belongs to that job —
 * later the job's page will list it — so a free-text "Miller kitchen" that
 * matches nothing would be a visit nothing can find.
 */

/** Start and end choices, every fifteen minutes. */
const STEPS = Array.from({ length: 96 }, (_, index) => index * 15);

export type Seed = { start: Date; end: Date } | { day: Date };

/** A task this time is being booked to get done — from the task's "Book time". */
export type TaskSeed = {
  id: string;
  number: number;
  title: string;
  job: ScheduleJob | null;
  assigneeId: string | null;
  dueOn: string | null;
};

export function VisitSheet({
  visit,
  seed,
  forTask,
  team,
  colorOf,
  defaultAssignee,
  pending,
  onSave,
  onDelete,
  onClose,
}: {
  /** Editing this visit; left out, booking a new one. */
  visit?: ScheduleVisit;
  /** For a new one: what was drawn or clicked. */
  seed?: Seed;
  /** For a new one: the task it's for, which fills in the job, title and who. */
  forTask?: TaskSeed;
  team: TeamMember[];
  colorOf: (userId: string) => Swatch;
  /** Who a new visit starts with on it — the person booking, usually. */
  defaultAssignee: string | null;
  pending: boolean;
  onSave: (draft: VisitDraft) => void;
  onDelete?: () => void;
  onClose: () => void;
}) {
  const start = visit?.startsAt
    ? new Date(visit.startsAt)
    : seed && "start" in seed
      ? seed.start
      : atMinutes(
          seed && "day" in seed
            ? seed.day
            : forTask?.dueOn
              ? fromISODate(forTask.dueOn)
              : new Date(),
          8 * 60
        );
  const end = visit?.endsAt
    ? new Date(visit.endsAt)
    : seed && "end" in seed
      ? seed.end
      : new Date(start.getTime() + 60 * 60_000);

  const [kind, setKind] = useState<VisitKind>(
    visit?.kind ?? (forTask && !forTask.job ? "other" : "work")
  );
  const [job, setJob] = useState<ScheduleJob | null>(visit?.job ?? forTask?.job ?? null);
  const [title, setTitle] = useState(visit?.customTitle ?? forTask?.title ?? "");
  const [task, setTask] = useState(visit?.task ?? (forTask ? { id: forTask.id, number: forTask.number, title: forTask.title } : null));
  const [notes, setNotes] = useState(visit?.notes ?? "");
  const [allDay, setAllDay] = useState(visit?.allDay ?? Boolean(seed && "day" in seed && !visit));
  const [date, setDate] = useState(toISODate(start));
  const [from, setFrom] = useState(minutesOfDay(start));
  const [to, setTo] = useState(Math.max(minutesOfDay(end), minutesOfDay(start) + 15));
  const [startsOn, setStartsOn] = useState(visit?.startsOn ?? toISODate(start));
  const [endsOn, setEndsOn] = useState(visit?.endsOn ?? toISODate(start));
  const [people, setPeople] = useState<string[]>(
    visit?.assignees ??
      (forTask?.assigneeId ? [forTask.assigneeId] : defaultAssignee ? [defaultAssignee] : [])
  );
  const [status, setStatus] = useState<VisitStatus>(visit?.status ?? "scheduled");

  const needsJob = visitKind(kind).needsJob;
  const problem =
    needsJob && !job
      ? "Pick the job."
      : allDay && endsOn < startsOn
        ? "The last day is before the first."
        : !allDay && to <= from
          ? "It has to end after it starts."
          : null;

  function save() {
    if (problem) return;
    const day = fromISODate(date);
    onSave({
      kind,
      jobId: kind === "time_off" ? null : (job?.id ?? null),
      title: title.trim() || null,
      notes: notes.trim() || null,
      allDay,
      startsAt: allDay ? null : atMinutes(day, from).toISOString(),
      endsAt: allDay ? null : atMinutes(day, to).toISOString(),
      startsOn: allDay ? startsOn : null,
      endsOn: allDay ? endsOn : null,
      status,
      assignees: people,
      taskId: task?.id ?? null,
    });
  }

  return (
    <ResponsiveDialog open onOpenChange={(open) => !open && !pending && onClose()}>
      <ResponsiveDialogContent desktopClassName="sm:max-w-lg">
        <ResponsiveDialogHeader title={visit ? "Change the visit" : "Book a visit"} />

        <ResponsiveDialogBody className="flex flex-col gap-5">
          {task ? (
            // Booked to get a task done — said, and undoable, at the top.
            <div className="bg-muted/50 flex items-center gap-2 rounded-lg border px-3 py-2 text-sm">
              <ListTodo className="text-muted-foreground size-4 shrink-0" />
              <span className="min-w-0 flex-1 truncate">
                For <span className="text-muted-foreground tabular-nums">T-{task.number}</span> {task.title}
              </span>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="text-muted-foreground size-6"
                aria-label="Not for this task"
                title="Not for this task"
                onClick={() => setTask(null)}
              >
                <X className="size-3.5" />
              </Button>
            </div>
          ) : null}

          {/* What it's for. */}
          <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-4">
            {VISIT_KINDS.map((entry) => (
              <Button
                key={entry.kind}
                type="button"
                size="sm"
                variant={kind === entry.kind ? "default" : "outline"}
                aria-pressed={kind === entry.kind}
                onClick={() => setKind(entry.kind)}
              >
                {entry.label}
              </Button>
            ))}
          </div>

          {kind === "time_off" ? null : (
            <div className="grid gap-1.5">
              <Label>
                Job
                {needsJob ? null : (
                  <span className="text-muted-foreground font-normal"> (optional)</span>
                )}
              </Label>
              <JobPicker value={job} onChange={setJob} />
            </div>
          )}

          <div className="grid gap-1.5">
            <Label htmlFor="visit-title">
              Title <span className="text-muted-foreground font-normal">(optional)</span>
            </Label>
            <Input
              id="visit-title"
              value={title}
              maxLength={120}
              onChange={(event) => setTitle(event.target.value)}
            />
            <p className="text-muted-foreground text-xs">
              {kind === "time_off"
                ? "Left blank, it says Time off."
                : "Left blank, it's named for the customer and the job."}
            </p>
          </div>

          {/* When. */}
          <div className="grid gap-3">
            <div className="flex items-center justify-between">
              <Label>When</Label>
              <label className="flex items-center gap-2 text-sm">
                All day
                <Switch checked={allDay} onCheckedChange={setAllDay} />
              </label>
            </div>
            {allDay ? (
              <div className="grid grid-cols-2 gap-3">
                <div className="grid gap-1">
                  <span className="text-muted-foreground text-xs">From</span>
                  <Input
                    type="date"
                    value={startsOn}
                    onChange={(event) => {
                      setStartsOn(event.target.value);
                      if (event.target.value > endsOn) setEndsOn(event.target.value);
                    }}
                  />
                </div>
                <div className="grid gap-1">
                  <span className="text-muted-foreground text-xs">To</span>
                  <Input
                    type="date"
                    value={endsOn}
                    min={startsOn}
                    onChange={(event) => setEndsOn(event.target.value)}
                  />
                </div>
              </div>
            ) : (
              // On a phone the day takes its own line, so the date isn't
              // cut to "09/23" beside two times.
              <div className="grid grid-cols-[auto_auto_auto] items-center justify-start gap-2 sm:grid-cols-[minmax(0,1fr)_auto_auto_auto]">
                <Input
                  type="date"
                  className="col-span-3 sm:col-span-1"
                  value={date}
                  onChange={(event) => setDate(event.target.value)}
                />
                <TimeSelect
                  value={from}
                  onChange={(next) => {
                    // Moving the start keeps the length, the way a calendar does.
                    const length = to - from;
                    setFrom(next);
                    setTo(Math.min(next + length, 24 * 60 - 15));
                  }}
                />
                <span className="text-muted-foreground text-sm">–</span>
                <TimeSelect value={to} onChange={setTo} after={from} />
              </div>
            )}
          </div>

          {/* Who. */}
          <div className="grid gap-1.5">
            <Label>People</Label>
            <div className="flex flex-col rounded-lg border">
              {team.map((member, index) => {
                const on = people.includes(member.userId);
                return (
                  <label
                    key={member.userId}
                    className={cn(
                      "hover:bg-muted/50 flex cursor-pointer items-center gap-3 px-3 py-2 text-sm",
                      index > 0 && "border-t"
                    )}
                  >
                    <Checkbox
                      checked={on}
                      className={colorOf(member.userId).check}
                      onCheckedChange={(checked) =>
                        setPeople((current) =>
                          checked
                            ? [...current, member.userId]
                            : current.filter((id) => id !== member.userId)
                        )
                      }
                    />
                    <span className="min-w-0 flex-1 truncate">{member.name}</span>
                    <span className="text-muted-foreground text-xs capitalize">{member.role}</span>
                  </label>
                );
              })}
            </div>
            {people.length === 0 && kind !== "time_off" ? (
              <p className="text-muted-foreground text-xs">
                Nobody on it yet — it shows grey until somebody is.
              </p>
            ) : null}
          </div>

          <div className="grid gap-1.5">
            <Label htmlFor="visit-notes">
              Notes <span className="text-muted-foreground font-normal">(optional)</span>
            </Label>
            <Textarea
              id="visit-notes"
              rows={3}
              className="min-h-20"
              value={notes}
              maxLength={2000}
              onChange={(event) => setNotes(event.target.value)}
            />
          </div>

          {visit ? (
            <div className="grid gap-1.5">
              <Label>Status</Label>
              <div className="grid grid-cols-3 gap-1.5">
                {(
                  [
                    ["scheduled", "Scheduled"],
                    ["done", "Done"],
                    ["cancelled", "Cancelled"],
                  ] as const
                ).map(([value, label]) => (
                  <Button
                    key={value}
                    type="button"
                    size="sm"
                    variant={status === value ? "default" : "outline"}
                    aria-pressed={status === value}
                    onClick={() => setStatus(value)}
                  >
                    {label}
                  </Button>
                ))}
              </div>
            </div>
          ) : null}
        </ResponsiveDialogBody>

        <ResponsiveDialogFooter className="flex items-center justify-between gap-2">
          {onDelete ? (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="text-muted-foreground hover:text-destructive"
              onClick={onDelete}
              disabled={pending}
            >
              <Trash2 className="size-4" />
              Delete
            </Button>
          ) : (
            // What's still missing, said beside the button it's holding back.
            <span className="text-muted-foreground text-xs">{problem}</span>
          )}
          <div className="flex gap-2">
            <Button type="button" variant="outline" onClick={onClose} disabled={pending}>
              Cancel
            </Button>
            <Button type="button" onClick={save} disabled={Boolean(problem) || pending}>
              {pending ? <Loader2 className="animate-spin" /> : null}
              {visit ? "Save" : "Book it"}
            </Button>
          </div>
        </ResponsiveDialogFooter>
      </ResponsiveDialogContent>
    </ResponsiveDialog>
  );
}

function TimeSelect({
  value,
  onChange,
  after,
}: {
  value: number;
  onChange: (minutes: number) => void;
  /** Only times later than this — for the end. */
  after?: number;
}) {
  const base = new Date(2000, 0, 1);
  const options = STEPS.filter((minutes) => after === undefined || minutes > after);
  if (after !== undefined) options.push(24 * 60 - 1);

  return (
    <Select value={String(value)} onValueChange={(next) => onChange(Number(next))}>
      <SelectTrigger className="w-28">
        <SelectValue />
      </SelectTrigger>
      <SelectContent className="max-h-72">
        {options.map((minutes) => (
          <SelectItem key={minutes} value={String(minutes)}>
            {minutes === 24 * 60 - 1
              ? "Midnight"
              : timeLabel(atMinutes(base, minutes))}
            {after !== undefined && minutes > after ? (
              <span className="text-muted-foreground ml-1 text-xs">
                {lengthLabel(minutes - after)}
              </span>
            ) : null}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

/** "45m", "2h", "2h 30m". */
function lengthLabel(minutes: number) {
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  if (!hours) return `${rest}m`;
  return rest ? `${hours}h ${rest}m` : `${hours}h`;
}
