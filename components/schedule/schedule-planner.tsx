"use client";

import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { ChevronLeft, ChevronRight, Loader2, Plus } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { useIsMobile } from "@/hooks/use-mobile";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import {
  fromISODate,
  rangeLabel,
  startOfDay,
  step,
  toISODate,
  type ScheduleView,
} from "@/lib/schedule/dates";
import { useTask } from "@/components/tasks/use-tasks";
import type {
  ScheduleConflict,
  ScheduleInspection,
  ScheduleTask,
  ScheduleVisit,
  TeamMember,
} from "@/lib/schedule/types";
import { cn } from "@/lib/utils";

import { swatches, UNASSIGNED, type Swatch } from "./colors";
import { InspectionCard, TaskCard, VisitCard } from "./detail-card";
import { MiniMonth } from "./mini-month";
import { MonthGrid } from "./month-grid";
import { TimeGrid } from "./time-grid";
import {
  useScheduleWindow,
  useVisitMutations,
  windowFor,
  type VisitDraft,
} from "./use-schedule";
import { VisitSheet, type Seed, type TaskSeed } from "./visit-sheet";

/**
 * The schedule — Google Calendar's shape, for a trade shop.
 *
 * **The shape is borrowed on purpose.** Every contractor already reads a
 * calendar like this one: a toolbar with Today and the arrows, a small month
 * in the corner, a colour per person, a week of hours with blocks on it. A new
 * shape would be a lesson; this one is a habit.
 *
 * **What's different is what a block is.** Every block is a visit to a job —
 * who, where, and the address a tap away — or time somebody isn't available.
 * Inspections sit on it too, read from their permits, so the week shows
 * everything that has a date on it without two places to keep dates.
 *
 * **Filtering is per person**, because "what's Sam doing Thursday" is the
 * question a shop owner asks most. Unticking a person hides their visits;
 * a visit with two people shows while either of them is ticked.
 */

const VIEWS: { view: ScheduleView; label: string; key: string }[] = [
  { view: "day", label: "Day", key: "d" },
  { view: "week", label: "Week", key: "w" },
  { view: "month", label: "Month", key: "m" },
];

type Sheet =
  | { mode: "create"; seed?: Seed; forTask?: TaskSeed }
  | { mode: "edit"; visit: ScheduleVisit };
type Card =
  | { kind: "visit"; id: string; at: { x: number; y: number } }
  | { kind: "inspection"; inspection: ScheduleInspection; at: { x: number; y: number } }
  | { kind: "task"; task: ScheduleTask; at: { x: number; y: number } };

const HIDDEN_KEY = "schedule:hidden-people";
const HIDDEN_CHANGED = "schedule:hidden-people:changed";

/**
 * Who's hidden — a viewer's convenience, remembered by this browser, not the
 * shop's setting. Read through `useSyncExternalStore` like the app's other
 * remembered toggles, so the server render (everyone shown) and the hydrating
 * one agree, and the saved answer arrives right after.
 */
function useHiddenPeople(): readonly [Set<string>, (next: Set<string>) => void] {
  const raw = useSyncExternalStore(
    (onChange) => {
      window.addEventListener("storage", onChange);
      window.addEventListener(HIDDEN_CHANGED, onChange);
      return () => {
        window.removeEventListener("storage", onChange);
        window.removeEventListener(HIDDEN_CHANGED, onChange);
      };
    },
    () => {
      try {
        return window.localStorage.getItem(HIDDEN_KEY) ?? "[]";
      } catch {
        return "[]";
      }
    },
    () => "[]"
  );

  const hidden = useMemo(() => {
    try {
      return new Set(JSON.parse(raw) as string[]);
    } catch {
      return new Set<string>();
    }
  }, [raw]);

  const set = useCallback((next: Set<string>) => {
    try {
      window.localStorage.setItem(HIDDEN_KEY, JSON.stringify([...next]));
    } catch {
      // Private window or blocked storage — it holds for this visit only.
    }
    window.dispatchEvent(new Event(HIDDEN_CHANGED));
  }, []);

  return [hidden, set] as const;
}

export function SchedulePlanner({
  team,
  me,
  initial,
}: {
  team: TeamMember[];
  /** The person looking — a new visit starts with them on it. */
  me: string;
  initial: {
    view: ScheduleView | null;
    date: string | null;
    visitId: string | null;
    /** A task whose "Book time" brought them here: the sheet opens filled in from it. */
    bookTask: string | null;
  };
}) {
  // A view somebody picked, or the one the link named; otherwise a phone opens
  // on a day — seven columns don't fit one — and anything wider on a week.
  const isMobile = useIsMobile();
  const [chosenView, setView] = useState<ScheduleView | null>(initial.view);
  const view: ScheduleView = chosenView ?? (isMobile ? "day" : "week");
  const [anchor, setAnchor] = useState(() =>
    initial.date ? fromISODate(initial.date) : startOfDay(new Date())
  );
  const [hidden, setHidden] = useHiddenPeople();
  const [inspectionsShown, setInspectionsShown] = useState(true);
  const [tasksShown, setTasksShown] = useState(true);
  const [chosenSheet, setSheet] = useState<Sheet | null>(null);
  // Booking time for a task: the sheet opens once the task has loaded, and the
  // request is forgotten when the sheet closes either way.
  const [bookTask, setBookTask] = useState(initial.bookTask);
  const booking = useTask(bookTask);
  const sheet: Sheet | null =
    chosenSheet ??
    (bookTask && booking.data
      ? {
          mode: "create",
          forTask: {
            id: booking.data.id,
            number: booking.data.number,
            title: booking.data.title,
            job: booking.data.job,
            assigneeId: booking.data.assigneeId,
            dueOn: booking.data.dueOn,
          },
        }
      : null);
  const sheetOpen = sheet !== null;
  const closeSheet = () => {
    setSheet(null);
    setBookTask(null);
  };
  const [picked, setCard] = useState<Card | null>(null);
  // The visit a notification's link named, opened once its week has loaded
  // and forgotten the moment anything else is opened or it's closed.
  const [linkedVisit, setLinkedVisit] = useState(initial.visitId);

  const window_ = useMemo(() => windowFor(view, anchor), [view, anchor]);
  const schedule = useScheduleWindow(window_);
  const { create, update, remove } = useVisitMutations();

  /* ── Colours and filtering ────────────────────────────────────────────── */

  const colours = useMemo(() => swatches(team.map((member) => member.userId)), [team]);
  const personColor = useCallback(
    (userId: string): Swatch => colours.get(userId) ?? UNASSIGNED,
    [colours]
  );
  const colorOf = useCallback(
    (visit: ScheduleVisit): Swatch => {
      const shown = visit.assignees.find((id) => !hidden.has(id)) ?? visit.assignees[0];
      return shown ? personColor(shown) : UNASSIGNED;
    },
    [hidden, personColor]
  );

  const visits = useMemo(
    () =>
      (schedule.data?.visits ?? []).filter((visit) =>
        visit.assignees.length
          ? visit.assignees.some((id) => !hidden.has(id))
          : !hidden.has("unassigned")
      ),
    [schedule.data, hidden]
  );
  const inspections = inspectionsShown ? (schedule.data?.inspections ?? []) : [];
  // A task shows while its person does; nobody's tasks with "Nobody on it yet".
  const dueTasks = useMemo(
    () =>
      tasksShown
        ? (schedule.data?.tasks ?? []).filter((task) =>
            task.assigneeId ? !hidden.has(task.assigneeId) : !hidden.has("unassigned")
          )
        : [],
    [schedule.data, hidden, tasksShown]
  );

  function toggle(id: string, shown: boolean) {
    const next = new Set(hidden);
    if (shown) next.delete(id);
    else next.add(id);
    setHidden(next);
  }

  /* ── The address bar says where you are ───────────────────────────────── */

  useEffect(() => {
    const params = new URLSearchParams({ view, date: toISODate(anchor) });
    window.history.replaceState(null, "", `/schedule?${params}`);
  }, [view, anchor]);

  const linked =
    linkedVisit && schedule.data?.visits.some((visit) => visit.id === linkedVisit)
      ? ({
          kind: "visit",
          id: linkedVisit,
          at: { x: window.innerWidth / 2 - 180, y: window.innerHeight / 3 },
        } as const)
      : null;
  const card: Card | null = picked ?? linked;

  function closeCard() {
    setCard(null);
    setLinkedVisit(null);
  }

  /* ── Keys, the way a calendar has them ────────────────────────────────── */

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement;
      if (
        event.metaKey ||
        event.ctrlKey ||
        event.altKey ||
        sheetOpen ||
        target.closest("input, textarea, select, [contenteditable], [role=dialog]")
      ) {
        return;
      }
      const key = event.key.toLowerCase();
      if (key === "t") setAnchor(startOfDay(new Date()));
      else if (key === "j" || key === "n") setAnchor((current) => step(view, current, 1));
      else if (key === "k" || key === "p") setAnchor((current) => step(view, current, -1));
      else if (key === "c") setSheet({ mode: "create" });
      else {
        const picked = VIEWS.find((entry) => entry.key === key);
        if (!picked) return;
        setView(picked.view);
      }
      // Handled here, so the app-wide shortcuts leave it alone — C is a new
      // visit on this page, not a new quote.
      event.preventDefault();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [view, sheetOpen]);

  /* ── Writing ──────────────────────────────────────────────────────────── */

  function sayConflicts(conflicts: ScheduleConflict[]) {
    if (conflicts.length === 0) return;
    const lines = conflicts.map((conflict) => {
      const name = team.find((member) => member.userId === conflict.userId)?.name ?? "Someone";
      return conflict.kind === "time_off"
        ? `${name} has time off then`
        : `${name} is also on ${conflict.title}`;
    });
    toast.warning("Booked twice", { description: [...new Set(lines)].join(". ") + "." });
  }

  function save(draft: VisitDraft) {
    if (sheet?.mode === "edit") {
      update.mutate(
        { id: sheet.visit.id, change: draft },
        {
          onSuccess: (result) => {
            closeSheet();
            toast.success("Visit saved.");
            sayConflicts(result.conflicts);
          },
          onError: (error) => toast.error(error.message),
        }
      );
      return;
    }
    create.mutate(draft, {
      onSuccess: (result) => {
        closeSheet();
        // Booked for another day: go there, so it's seen landing.
        const day = result.visit.startsAt
          ? startOfDay(new Date(result.visit.startsAt))
          : fromISODate(result.visit.startsOn!);
        if (!window_.days.some((shown) => shown.getTime() === day.getTime())) setAnchor(day);
        toast.success("Visit booked.");
        sayConflicts(result.conflicts);
      },
      onError: (error) => toast.error(error.message),
    });
  }

  function move(visit: ScheduleVisit, start: Date, end: Date) {
    update.mutate(
      { id: visit.id, change: { startsAt: start.toISOString(), endsAt: end.toISOString() } },
      {
        onSuccess: (result) => sayConflicts(result.conflicts),
        onError: (error) => toast.error(`${error.message} It's back where it was.`),
      }
    );
  }

  function setStatus(visit: ScheduleVisit, status: ScheduleVisit["status"]) {
    update.mutate(
      { id: visit.id, change: { status } },
      {
        onSuccess: () => toast.success(status === "done" ? "Marked done." : "Back on the schedule."),
        onError: (error) => toast.error(error.message),
      }
    );
  }

  function discard(visit: ScheduleVisit) {
    closeCard();
    closeSheet();
    remove.mutate(visit.id, {
      // One tap on the bin takes it off, so one tap puts it back.
      onSuccess: () =>
        toast.success("Visit removed.", {
          duration: 10_000,
          action: { label: "Undo", onClick: () => restore(visit) },
        }),
      onError: (error) => toast.error(error.message),
    });
  }

  function restore(visit: ScheduleVisit) {
    create.mutate(
      {
        kind: visit.kind,
        jobId: visit.job?.id ?? null,
        title: visit.customTitle,
        notes: visit.notes,
        allDay: visit.allDay,
        startsAt: visit.startsAt,
        endsAt: visit.endsAt,
        startsOn: visit.startsOn,
        endsOn: visit.endsOn,
        status: visit.status,
        assignees: visit.assignees,
      },
      {
        onSuccess: () => toast.success("Visit put back."),
        onError: (error) => toast.error(error.message),
      }
    );
  }

  const openVisit = card?.kind === "visit"
    ? (schedule.data?.visits ?? []).find((visit) => visit.id === card.id)
    : undefined;

  /* ── The page ─────────────────────────────────────────────────────────── */

  const isToday = window_.days.some((day) => day.getTime() === startOfDay(new Date()).getTime());

  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* Toolbar. */}
      <div className="flex flex-wrap items-center gap-2 border-b px-4 py-2.5 md:px-5">
        <Button
          variant="outline"
          size="sm"
          onClick={() => setAnchor(startOfDay(new Date()))}
          disabled={isToday && view !== "month"}
          title="Today (T)"
        >
          Today
        </Button>
        <div className="flex">
          <Button variant="ghost" size="icon" className="size-8" aria-label="Previous (K)" title="Previous (K)" onClick={() => setAnchor(step(view, anchor, -1))}>
            <ChevronLeft className="size-4" />
          </Button>
          <Button variant="ghost" size="icon" className="size-8" aria-label="Next (J)" title="Next (J)" onClick={() => setAnchor(step(view, anchor, 1))}>
            <ChevronRight className="size-4" />
          </Button>
        </div>
        <h1 className="min-w-0 truncate text-lg font-semibold tracking-tight">
          <span className="sm:hidden">{rangeLabel(view, anchor, true)}</span>
          <span className="hidden sm:inline">{rangeLabel(view, anchor)}</span>
        </h1>
        {schedule.isFetching ? (
          <Loader2 className="text-muted-foreground size-4 animate-spin" aria-label="Loading" />
        ) : null}

        {/* Its own row on a phone, switcher left and Book right. */}
        <div className="flex w-full items-center justify-between gap-2 sm:ml-auto sm:w-auto">
          <div className="bg-muted flex rounded-lg p-0.5" role="group" aria-label="View">
            {VIEWS.map((entry) => (
              <button
                key={entry.view}
                type="button"
                aria-pressed={view === entry.view}
                title={`${entry.label} (${entry.key.toUpperCase()})`}
                onClick={() => setView(entry.view)}
                className={cn(
                  "rounded-md px-3 py-1 text-sm transition-colors",
                  view === entry.view
                    ? "bg-background font-medium shadow-sm"
                    : "text-muted-foreground hover:text-foreground"
                )}
              >
                {entry.label}
              </button>
            ))}
          </div>
          <Button size="sm" onClick={() => setSheet({ mode: "create" })} className="lg:hidden">
            <Plus className="size-4" />
            Book
          </Button>
        </div>
      </div>

      <div className="flex min-h-0 flex-1">
        {/* The rail. */}
        <aside className="hidden w-64 shrink-0 flex-col gap-6 overflow-y-auto border-r p-4 lg:flex">
          <Button className="self-start" onClick={() => setSheet({ mode: "create" })} title="Book a visit (C)">
            <Plus className="size-4" />
            Book a visit
          </Button>

          <MiniMonth
            selected={anchor}
            shown={window_.days}
            onPick={(day) => setAnchor(day)}
          />

          <div>
            <p className="text-muted-foreground mb-2 font-label text-[10px] uppercase">People</p>
            <div className="flex flex-col gap-1">
              {team.map((member) => (
                <label
                  key={member.userId}
                  className="hover:bg-muted/60 flex cursor-pointer items-center gap-2.5 rounded-md px-2 py-1.5 text-sm"
                >
                  <Checkbox
                    checked={!hidden.has(member.userId)}
                    onCheckedChange={(checked) => toggle(member.userId, checked === true)}
                    className={personColor(member.userId).check}
                  />
                  <span className="min-w-0 truncate">
                    {member.name}
                    {member.userId === me ? (
                      <span className="text-muted-foreground"> (you)</span>
                    ) : null}
                  </span>
                </label>
              ))}
              <label className="hover:bg-muted/60 flex cursor-pointer items-center gap-2.5 rounded-md px-2 py-1.5 text-sm">
                <Checkbox
                  checked={!hidden.has("unassigned")}
                  onCheckedChange={(checked) => toggle("unassigned", checked === true)}
                  className={UNASSIGNED.check}
                />
                <span className="text-muted-foreground">Nobody on it yet</span>
              </label>
            </div>
          </div>

          <div>
            <p className="text-muted-foreground mb-2 font-label text-[10px] uppercase">Also show</p>
            <div className="flex items-center gap-2.5 px-2">
              <Checkbox
                id="show-inspections"
                checked={inspectionsShown}
                onCheckedChange={(checked) => setInspectionsShown(checked === true)}
              />
              <Label htmlFor="show-inspections" className="font-normal">
                Inspections
              </Label>
            </div>
            <div className="mt-2 flex items-center gap-2.5 px-2">
              <Checkbox
                id="show-tasks"
                checked={tasksShown}
                onCheckedChange={(checked) => setTasksShown(checked === true)}
              />
              <Label htmlFor="show-tasks" className="font-normal">
                Tasks due
              </Label>
            </div>
          </div>
        </aside>

        {/* The view. */}
        <div className="min-h-0 min-w-0 flex-1">
          {schedule.isError && !schedule.data ? (
            <div className="flex h-full flex-col items-center justify-center gap-3 p-8 text-center">
              <p className="text-sm">{schedule.error.message}</p>
              <Button variant="outline" size="sm" onClick={() => schedule.refetch()}>
                Try again
              </Button>
            </div>
          ) : view === "month" ? (
            <MonthGrid
              days={window_.days}
              month={anchor.getMonth()}
              visits={visits}
              inspections={inspections}
              tasks={dueTasks}
              colorOf={colorOf}
              onCreate={({ day }) => setSheet({ mode: "create", seed: { day } })}
              onOpen={(visit, at) => setCard({ kind: "visit", id: visit.id, at })}
              onOpenInspection={(inspection, at) => setCard({ kind: "inspection", inspection, at })}
              onOpenTask={(task, at) => setCard({ kind: "task", task, at })}
              onPickDay={(day) => {
                setAnchor(day);
                setView("day");
              }}
            />
          ) : (
            <TimeGrid
              key={`${view}-${window_.startDate}`}
              days={window_.days}
              visits={visits}
              inspections={inspections}
              tasks={dueTasks}
              colorOf={colorOf}
              onCreate={(seed) => setSheet({ mode: "create", seed })}
              onOpen={(visit, at) => setCard({ kind: "visit", id: visit.id, at })}
              onOpenInspection={(inspection, at) => setCard({ kind: "inspection", inspection, at })}
              onOpenTask={(task, at) => setCard({ kind: "task", task, at })}
              onMove={move}
              onPickDay={(day) => {
                setAnchor(day);
                setView("day");
              }}
            />
          )}
        </div>
      </div>

      {openVisit && card?.kind === "visit" ? (
        <VisitCard
          visit={openVisit}
          at={card.at}
          team={team}
          colorOf={colorOf}
          personColor={personColor}
          onEdit={() => {
            closeCard();
            setSheet({ mode: "edit", visit: openVisit });
          }}
          onStatus={(status) => setStatus(openVisit, status)}
          onDelete={() => discard(openVisit)}
          onClose={closeCard}
        />
      ) : null}

      {card?.kind === "inspection" ? (
        <InspectionCard inspection={card.inspection} at={card.at} onClose={closeCard} />
      ) : null}

      {card?.kind === "task" ? (
        <TaskCard task={card.task} at={card.at} team={team} personColor={personColor} onClose={closeCard} />
      ) : null}

      {sheet ? (
        <VisitSheet
          key={sheet.mode === "edit" ? sheet.visit.id : sheet.forTask ? `task-${sheet.forTask.id}` : "new"}
          visit={sheet.mode === "edit" ? sheet.visit : undefined}
          seed={sheet.mode === "create" ? sheet.seed : undefined}
          forTask={sheet.mode === "create" ? sheet.forTask : undefined}
          team={team}
          colorOf={personColor}
          defaultAssignee={team.some((member) => member.userId === me) ? me : null}
          pending={create.isPending || update.isPending}
          onSave={save}
          onDelete={sheet.mode === "edit" ? () => discard(sheet.visit) : undefined}
          onClose={closeSheet}
        />
      ) : null}
    </div>
  );
}
