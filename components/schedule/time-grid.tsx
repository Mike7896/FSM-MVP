"use client";

import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { Check, ShieldCheck } from "lucide-react";

import {
  addDays,
  atMinutes,
  fromISODate,
  hourLabel,
  minutesOfDay,
  sameDay,
  startOfDay,
  timeLabel,
  timeRangeLabel,
  toISODate,
} from "@/lib/schedule/dates";
import { StatusIcon } from "@/components/tasks/task-bits";
import type { ScheduleInspection, ScheduleTask, ScheduleVisit } from "@/lib/schedule/types";
import { cn } from "@/lib/utils";

import type { Swatch } from "./colors";

/**
 * The day and week views — hours down the side, days across the top.
 *
 * **Drawn the way a paper day-planner is**, which is what Google Calendar is
 * too: an hour is a fixed height, a visit is a block as tall as it is long,
 * two visits at once sit side by side, and a red line says where now is.
 *
 * **Everything is direct.** Drag across empty time to book it; drag a block to
 * move it, across days too; drag its bottom edge to make it longer. Fifteen
 * minutes is the grain — nobody books a job for 8:07. A press that doesn't move
 * is a click, and opens the visit.
 *
 * All-day visits and inspections sit in their own lane above the hours, a
 * multi-day visit as one bar across the days it covers.
 */

/** Pixels per hour. 48 fits a working day on a laptop without scrolling much. */
const HOUR = 48;
const SNAP = 15;
/** Movement before a press becomes a drag rather than a click. */
const DRAG_THRESHOLD = 4;

type Drag =
  | {
      mode: "create";
      day: number;
      from: number;
      to: number;
    }
  | {
      mode: "move" | "resize";
      visit: ScheduleVisit;
      originDay: number;
      originMinutes: number;
      startX: number;
      startY: number;
      started: boolean;
      start: Date;
      end: Date;
    };

export function TimeGrid({
  days,
  visits,
  inspections,
  tasks,
  colorOf,
  onCreate,
  onOpen,
  onOpenInspection,
  onOpenTask,
  onMove,
  onPickDay,
}: {
  days: Date[];
  visits: ScheduleVisit[];
  inspections: ScheduleInspection[];
  tasks: ScheduleTask[];
  colorOf: (visit: ScheduleVisit) => Swatch;
  onCreate: (time: { start: Date; end: Date } | { day: Date }) => void;
  onOpen: (visit: ScheduleVisit, at: { x: number; y: number }) => void;
  onOpenInspection: (inspection: ScheduleInspection, at: { x: number; y: number }) => void;
  onOpenTask: (task: ScheduleTask, at: { x: number; y: number }) => void;
  onMove: (visit: ScheduleVisit, start: Date, end: Date) => void;
  onPickDay: (day: Date) => void;
}) {
  const scroller = useRef<HTMLDivElement>(null);
  const body = useRef<HTMLDivElement>(null);
  const columns = useRef<(HTMLDivElement | null)[]>([]);
  const [drag, setDrag] = useState<Drag | null>(null);
  const now = useNow();

  // Open on the working day, not at midnight. Once, on arrival — scrolling
  // is theirs after that.
  useLayoutEffect(() => {
    const earliest = visits
      .filter((visit) => !visit.allDay && visit.startsAt)
      .map((visit) => new Date(visit.startsAt!))
      .filter((start) => days.some((day) => sameDay(day, start)))
      .map((start) => start.getHours());
    const hour = Math.min(7, ...earliest);
    if (scroller.current) scroller.current.scrollTop = Math.max(0, hour * HOUR - 8);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- on arrival only
  }, []);

  /* ── Where the pointer is ─────────────────────────────────────────────── */

  function minutesAt(clientY: number) {
    const top = body.current!.getBoundingClientRect().top;
    const raw = ((clientY - top) / HOUR) * 60;
    return Math.min(24 * 60, Math.max(0, Math.round(raw / SNAP) * SNAP));
  }

  function dayAt(clientX: number, fallback: number) {
    const index = columns.current.findIndex((column) => {
      if (!column) return false;
      const rect = column.getBoundingClientRect();
      return clientX >= rect.left && clientX < rect.right;
    });
    return index === -1 ? fallback : index;
  }

  /* ── Pressing ─────────────────────────────────────────────────────────── */

  function pressEmpty(event: ReactPointerEvent<HTMLDivElement>, day: number) {
    if (event.button !== 0) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    const from = Math.min(minutesAt(event.clientY), 24 * 60 - SNAP);
    setDrag({ mode: "create", day, from, to: from + 30 });
  }

  function pressVisit(
    event: ReactPointerEvent<HTMLElement>,
    visit: ScheduleVisit,
    day: number,
    mode: "move" | "resize"
  ) {
    if (event.button !== 0) return;
    event.stopPropagation();
    (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
    setDrag({
      mode,
      visit,
      originDay: day,
      originMinutes: minutesAt(event.clientY),
      startX: event.clientX,
      startY: event.clientY,
      started: false,
      start: new Date(visit.startsAt!),
      end: new Date(visit.endsAt!),
    });
  }

  function movePointer(event: ReactPointerEvent) {
    if (!drag) return;

    if (drag.mode === "create") {
      const at = minutesAt(event.clientY);
      setDrag({ ...drag, to: Math.max(at, drag.from + SNAP) });
      return;
    }

    const travelled = Math.hypot(event.clientX - drag.startX, event.clientY - drag.startY);
    if (!drag.started && travelled < DRAG_THRESHOLD) return;

    const original = { start: new Date(drag.visit.startsAt!), end: new Date(drag.visit.endsAt!) };

    if (drag.mode === "resize") {
      const day = days[drag.originDay];
      const end = atMinutes(day, minutesAt(event.clientY));
      const floor = new Date(original.start.getTime() + SNAP * 60_000);
      setDrag({ ...drag, started: true, end: end > floor ? end : floor });
      return;
    }

    // Moved by however far the pointer moved, in days and in minutes, so a
    // block grabbed by its middle stays under the finger.
    const day = dayAt(event.clientX, drag.originDay);
    const from = atMinutes(days[drag.originDay], drag.originMinutes).getTime();
    const to = atMinutes(days[day], minutesAt(event.clientY)).getTime();
    const delta = to - from;
    setDrag({
      ...drag,
      started: true,
      start: new Date(original.start.getTime() + delta),
      end: new Date(original.end.getTime() + delta),
    });
  }

  function release(event: ReactPointerEvent) {
    if (!drag) return;
    const done = drag;
    setDrag(null);

    if (done.mode === "create") {
      const day = days[done.day];
      onCreate({ start: atMinutes(day, done.from), end: atMinutes(day, done.to) });
      return;
    }

    if (!done.started) {
      onOpen(done.visit, { x: event.clientX, y: event.clientY });
      return;
    }

    const unchanged =
      done.start.getTime() === new Date(done.visit.startsAt!).getTime() &&
      done.end.getTime() === new Date(done.visit.endsAt!).getTime();
    if (!unchanged) onMove(done.visit, done.start, done.end);
  }

  // Escape puts a drag back where it started.
  useEffect(() => {
    if (!drag) return;
    const cancel = (event: KeyboardEvent) => {
      if (event.key === "Escape") setDrag(null);
    };
    window.addEventListener("keydown", cancel);
    return () => window.removeEventListener("keydown", cancel);
  }, [drag]);

  /* ── What's drawn ─────────────────────────────────────────────────────── */

  // The visit being dragged is drawn at where it's going, not where it was.
  const shown = useMemo(
    () =>
      visits.map((visit) =>
        drag && drag.mode !== "create" && drag.started && drag.visit.id === visit.id
          ? { ...visit, startsAt: drag.start.toISOString(), endsAt: drag.end.toISOString() }
          : visit
      ),
    [visits, drag]
  );

  const timed = shown.filter((visit) => !visit.allDay && visit.startsAt && visit.endsAt);
  const lanes = allDayLanes(
    days,
    shown.filter((visit) => visit.allDay),
    inspections,
    tasks
  );

  const columnsTemplate = `3.5rem repeat(${days.length}, minmax(0, 1fr))`;

  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* Day headings. */}
      <div className="grid border-b" style={{ gridTemplateColumns: columnsTemplate }}>
        <div />
        {days.map((day) => {
          const today = sameDay(day, now);
          return (
            <button
              key={day.toISOString()}
              type="button"
              onClick={() => onPickDay(day)}
              className="group flex flex-col items-center gap-0.5 border-l py-2"
            >
              <span
                className={cn(
                  "font-label text-[10px] uppercase",
                  today ? "text-primary-ink" : "text-muted-foreground"
                )}
              >
                {day.toLocaleDateString("en-US", { weekday: "short" })}
              </span>
              <span
                className={cn(
                  "flex size-9 items-center justify-center rounded-full text-lg tabular-nums transition-colors",
                  today
                    ? "bg-primary text-primary-foreground font-semibold"
                    : "group-hover:bg-muted"
                )}
              >
                {day.getDate()}
              </span>
            </button>
          );
        })}
      </div>

      {/* All day. */}
      <div
        className="grid border-b"
        style={{ gridTemplateColumns: columnsTemplate }}
      >
        <div className="text-muted-foreground flex items-start justify-end pt-1.5 pr-2 text-[10px]">
          All day
        </div>
        <div
          className="relative col-span-full col-start-2 grid min-h-8 gap-y-1 py-1"
          style={{ gridTemplateColumns: `repeat(${days.length}, minmax(0, 1fr))` }}
        >
          {/* Clicking the lane books a day, not an hour. */}
          {days.map((day, index) => (
            <button
              key={day.toISOString()}
              type="button"
              aria-label={`Book ${day.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" })}, all day`}
              onClick={() => onCreate({ day })}
              className="hover:bg-muted/50 border-l"
              style={{ gridColumn: index + 1, gridRow: `1 / span ${Math.max(1, lanes.count)}` }}
            />
          ))}
          {lanes.items.map((item) => (
            <button
              key={item.key}
              type="button"
              onClick={(event) => {
                const at = { x: event.clientX, y: event.clientY };
                if (item.visit) onOpen(item.visit, at);
                else if (item.task) onOpenTask(item.task, at);
                else onOpenInspection(item.inspection!, at);
              }}
              className={cn(
                "relative z-10 mx-0.5 flex min-w-0 items-center gap-1 truncate rounded px-1.5 py-0.5 text-left text-xs",
                item.visit
                  ? cn("border-l-[3px]", colorOf(item.visit).block, statusLook(item.visit))
                  : item.task
                    ? cn("bg-background hover:bg-muted border", item.task.status === "done" && "text-muted-foreground line-through")
                    : "border-foreground/30 bg-background hover:bg-muted border border-dashed"
              )}
              style={{ gridColumn: `${item.from + 1} / ${item.to + 2}`, gridRow: item.lane + 1 }}
            >
              {item.inspection ? <ShieldCheck className="size-3 shrink-0" /> : null}
              {item.task ? <StatusIcon status={item.task.status} className="size-3" /> : null}
              <span className="truncate font-medium">{item.label}</span>
            </button>
          ))}
        </div>
      </div>

      {/* The hours. */}
      <div ref={scroller} className="min-h-0 flex-1 overflow-y-auto [scrollbar-width:thin]">
        <div
          ref={body}
          className="relative grid select-none"
          style={{ gridTemplateColumns: columnsTemplate, height: 24 * HOUR }}
          onPointerMove={movePointer}
          onPointerUp={release}
          onPointerCancel={() => setDrag(null)}
        >
          {/* Gutter. */}
          <div className="relative">
            {Array.from({ length: 24 }, (_, hour) => (
              <span
                key={hour}
                className="text-muted-foreground absolute right-2 -translate-y-1/2 text-[10px] tabular-nums"
                style={{ top: hour * HOUR }}
              >
                {hourLabel(hour)}
              </span>
            ))}
          </div>

          {days.map((day, index) => {
            const dayStart = startOfDay(day);
            const dayEnd = addDays(dayStart, 1);
            const segments = layout(
              timed
                .map((visit) => segmentOf(visit, dayStart, dayEnd))
                .filter((segment) => segment !== null)
            );
            const today = sameDay(day, now);

            return (
              <div
                key={day.toISOString()}
                ref={(element) => {
                  columns.current[index] = element;
                }}
                className="relative border-l"
                onPointerDown={(event) => {
                  if (event.target === event.currentTarget) pressEmpty(event, index);
                }}
              >
                {/* Hour and half-hour rules. */}
                {Array.from({ length: 24 }, (_, hour) => (
                  <div
                    key={hour}
                    className="pointer-events-none absolute inset-x-0 border-t"
                    style={{ top: hour * HOUR }}
                  >
                    <div className="border-border/40 border-t border-dashed" style={{ marginTop: HOUR / 2 - 1 }} />
                  </div>
                ))}

                {segments.map(({ visit, top, height, column, columns: of, startsHere, endsHere }) => {
                  const start = new Date(visit.startsAt!);
                  const end = new Date(visit.endsAt!);
                  const dragging = drag && drag.mode !== "create" && drag.started && drag.visit.id === visit.id;
                  return (
                    <div
                      key={visit.id}
                      role="button"
                      tabIndex={0}
                      onKeyDown={(event) => {
                        if (event.key === "Enter") {
                          const rect = event.currentTarget.getBoundingClientRect();
                          onOpen(visit, { x: rect.right, y: rect.top });
                        }
                      }}
                      onPointerDown={(event) => pressVisit(event, visit, index, "move")}
                      className={cn(
                        "absolute z-10 flex cursor-grab flex-col overflow-hidden rounded-md border-l-[3px] px-1.5 py-0.5 text-left text-xs leading-tight shadow-[0_0_0_1px_var(--background)] transition-colors",
                        colorOf(visit).block,
                        statusLook(visit),
                        dragging && "z-20 cursor-grabbing opacity-90 shadow-lg"
                      )}
                      style={{
                        top,
                        height: Math.max(height, 18),
                        left: `calc(${(column / of) * 100}% + 2px)`,
                        // The last column stops short of the edge, leaving a
                        // strip to drag a new visit into beside it.
                        width: `calc(${100 / of}% - ${column === of - 1 ? 12 : 4}px)`,
                      }}
                    >
                      <span className="flex min-w-0 items-center gap-1 font-semibold">
                        {visit.status === "done" ? <Check className="size-3 shrink-0" /> : null}
                        <span className="truncate">{visit.title}</span>
                      </span>
                      {height >= 34 ? (
                        <span className="text-foreground/70 truncate text-[11px]">
                          {startsHere || endsHere ? timeRangeLabel(start, end) : "Continues"}
                        </span>
                      ) : null}
                      {height >= 58 && visit.job?.address ? (
                        <span className="text-foreground/60 truncate text-[11px]">
                          {visit.job.address}
                        </span>
                      ) : null}
                      {/* The bottom edge, for making it longer. */}
                      {endsHere ? (
                        <span
                          aria-hidden
                          onPointerDown={(event) => pressVisit(event, visit, index, "resize")}
                          className="absolute inset-x-0 bottom-0 h-2 cursor-ns-resize"
                        />
                      ) : null}
                    </div>
                  );
                })}

                {/* The block being drawn. */}
                {drag?.mode === "create" && drag.day === index ? (
                  <div
                    className="bg-primary/25 border-primary pointer-events-none absolute inset-x-0.5 z-20 rounded-md border-l-[3px] px-1.5 py-0.5 text-xs font-semibold"
                    style={{ top: (drag.from / 60) * HOUR, height: ((drag.to - drag.from) / 60) * HOUR }}
                  >
                    {timeRangeLabel(atMinutes(day, drag.from), atMinutes(day, drag.to))}
                  </div>
                ) : null}

                {today ? (
                  <div
                    className="pointer-events-none absolute inset-x-0 z-30 border-t-2 border-red-500"
                    style={{ top: (minutesOfDay(now) / 60) * HOUR }}
                  >
                    <span className="absolute -top-[5px] -left-[5px] size-2 rounded-full bg-red-500" />
                  </div>
                ) : null}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

/* ── Layout ───────────────────────────────────────────────────────────── */

type Segment = {
  visit: ScheduleVisit;
  start: number;
  end: number;
  startsHere: boolean;
  endsHere: boolean;
};

/** The part of a visit that falls on one day, in minutes past midnight. */
function segmentOf(visit: ScheduleVisit, dayStart: Date, dayEnd: Date): Segment | null {
  const start = new Date(visit.startsAt!);
  const end = new Date(visit.endsAt!);
  if (end <= dayStart || start >= dayEnd) return null;
  const from = start < dayStart ? 0 : (start.getTime() - dayStart.getTime()) / 60_000;
  const to = end > dayEnd ? 24 * 60 : (end.getTime() - dayStart.getTime()) / 60_000;
  return { visit, start: from, end: to, startsHere: start >= dayStart, endsHere: end <= dayEnd };
}

/**
 * Side by side where they overlap. Visits are grouped into runs that touch
 * each other; each run is split into as many columns as it needs at its
 * busiest, and each visit takes the first column free when it starts.
 */
function layout(segments: Segment[]) {
  const sorted = [...segments].sort((a, b) => a.start - b.start || b.end - a.end);
  const placed: (Segment & { column: number; columns: number; top: number; height: number })[] = [];

  let run: typeof placed = [];
  let runEnd = -1;
  const close = () => {
    const columns = Math.max(1, ...run.map((item) => item.column + 1));
    for (const item of run) item.columns = columns;
    run = [];
  };

  for (const segment of sorted) {
    if (segment.start >= runEnd && run.length) close();
    const busy = new Set(
      run.filter((item) => item.end > segment.start).map((item) => item.column)
    );
    let column = 0;
    while (busy.has(column)) column += 1;
    const item = {
      ...segment,
      column,
      columns: 1,
      top: (segment.start / 60) * HOUR,
      height: ((segment.end - segment.start) / 60) * HOUR - 2,
    };
    run.push(item);
    placed.push(item);
    runEnd = Math.max(runEnd, segment.end);
  }
  if (run.length) close();
  return placed;
}

type LaneItem = {
  key: string;
  from: number;
  to: number;
  lane: number;
  label: string;
  visit?: ScheduleVisit;
  inspection?: ScheduleInspection;
  task?: ScheduleTask;
};

/**
 * All-day visits as bars across their days, stacked so none overlap — and
 * the day's inspections and due tasks as one-day chips beside them.
 */
function allDayLanes(
  days: Date[],
  allDay: ScheduleVisit[],
  inspections: ScheduleInspection[],
  tasks: ScheduleTask[]
) {
  const first = toISODate(days[0]);
  const last = toISODate(days[days.length - 1]);
  const indexOf = (iso: string) =>
    Math.round((fromISODate(iso).getTime() - fromISODate(first).getTime()) / 86_400_000);

  const spans: Omit<LaneItem, "lane">[] = [
    ...allDay
      .filter((visit) => visit.startsOn! <= last && visit.endsOn! >= first)
      .map((visit) => ({
        key: visit.id,
        from: Math.max(0, indexOf(visit.startsOn!)),
        to: Math.min(days.length - 1, indexOf(visit.endsOn!)),
        label: visit.title,
        visit,
      })),
    ...inspections
      .filter((inspection) => inspection.on >= first && inspection.on <= last)
      .map((inspection) => ({
        key: `inspection-${inspection.id}`,
        from: indexOf(inspection.on),
        to: indexOf(inspection.on),
        label: `${inspection.type.replace(/_/g, "-")} inspection · ${surname(inspection.job.customerName)}`,
        inspection,
      })),
    ...tasks
      .filter((task) => task.dueOn >= first && task.dueOn <= last)
      .map((task) => ({
        key: `task-${task.id}`,
        from: indexOf(task.dueOn),
        to: indexOf(task.dueOn),
        label: task.title,
        task,
      })),
  ].sort((a, b) => a.from - b.from || b.to - b.from - (a.to - a.from));

  const lanesEnd: number[] = [];
  const items = spans.map((span) => {
    let lane = lanesEnd.findIndex((end) => end < span.from);
    if (lane === -1) lane = lanesEnd.length;
    lanesEnd[lane] = span.to;
    return { ...span, lane };
  });

  return { items, count: lanesEnd.length };
}

function surname(name: string | null) {
  return name?.trim().split(/\s+/).at(-1) ?? "";
}

/** Done reads as finished; cancelled as struck out but still there. */
export function statusLook(visit: ScheduleVisit) {
  if (visit.status === "cancelled") return "line-through opacity-50";
  if (visit.status === "done") return "opacity-60";
  return "";
}

/** The current minute, kept current. */
function useNow() {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 60_000);
    return () => clearInterval(timer);
  }, []);
  return now;
}

export { timeLabel };
