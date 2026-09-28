"use client";

import { ShieldCheck } from "lucide-react";

import { sameDay, startOfDay, addDays, timeLabel, toISODate } from "@/lib/schedule/dates";
import { StatusIcon } from "@/components/tasks/task-bits";
import type { ScheduleInspection, ScheduleTask, ScheduleVisit } from "@/lib/schedule/types";
import { cn } from "@/lib/utils";

import type { Swatch } from "./colors";
import { statusLook } from "./time-grid";

/**
 * The month — six weeks, a square a day, the way a wall calendar hangs.
 *
 * For seeing the shape of a month rather than working a day: which days are
 * full, which are open, where the gaps are. Each day shows as many visits as
 * fit and says how many more; the day's number opens that day.
 */

/** Past this many, a day says "+N more" instead of shrinking the rest. */
const SHOWN = 3;

export function MonthGrid({
  days,
  month,
  visits,
  inspections,
  tasks,
  colorOf,
  onCreate,
  onOpen,
  onOpenInspection,
  onOpenTask,
  onPickDay,
}: {
  days: Date[];
  /** The month being shown — days outside it are drawn quieter. */
  month: number;
  visits: ScheduleVisit[];
  inspections: ScheduleInspection[];
  tasks: ScheduleTask[];
  colorOf: (visit: ScheduleVisit) => Swatch;
  onCreate: (time: { day: Date }) => void;
  onOpen: (visit: ScheduleVisit, at: { x: number; y: number }) => void;
  onOpenInspection: (inspection: ScheduleInspection, at: { x: number; y: number }) => void;
  onOpenTask: (task: ScheduleTask, at: { x: number; y: number }) => void;
  onPickDay: (day: Date) => void;
}) {
  const today = new Date();

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="grid grid-cols-7 border-b">
        {days.slice(0, 7).map((day) => (
          <div
            key={day.toISOString()}
            className="text-muted-foreground border-l py-2 text-center font-label text-[10px] uppercase first:border-l-0"
          >
            {day.toLocaleDateString("en-US", { weekday: "short" })}
          </div>
        ))}
      </div>

      <div className="grid min-h-0 flex-1 grid-cols-7 grid-rows-6">
        {days.map((day, index) => {
          const items = onDay(day, visits, inspections, tasks);
          const extra = items.length - SHOWN;
          const outside = day.getMonth() !== month;

          return (
            <div
              key={day.toISOString()}
              onClick={(event) => {
                if (event.target === event.currentTarget) onCreate({ day });
              }}
              className={cn(
                "flex min-h-0 min-w-0 flex-col gap-0.5 overflow-hidden border-b border-l p-1",
                index % 7 === 0 && "border-l-0",
                outside && "bg-muted/30"
              )}
            >
              <button
                type="button"
                onClick={() => onPickDay(day)}
                className={cn(
                  "mx-auto mb-0.5 flex size-6 shrink-0 items-center justify-center rounded-full text-xs tabular-nums transition-colors",
                  sameDay(day, today)
                    ? "bg-primary text-primary-foreground font-semibold"
                    : outside
                      ? "text-muted-foreground hover:bg-muted"
                      : "hover:bg-muted"
                )}
              >
                {day.getDate()}
              </button>

              {items.slice(0, extra > 0 ? SHOWN - 1 : SHOWN).map((item) =>
                item.visit ? (
                  <button
                    key={item.key}
                    type="button"
                    onClick={(event) => onOpen(item.visit!, { x: event.clientX, y: event.clientY })}
                    className={cn(
                      "flex min-w-0 items-center gap-1 rounded px-1 text-left text-[11px] leading-5",
                      item.visit.allDay
                        ? cn("border-l-[3px] font-medium", colorOf(item.visit).block)
                        : "hover:bg-muted",
                      statusLook(item.visit)
                    )}
                  >
                    {item.visit.allDay ? null : (
                      <span className={cn("size-1.5 shrink-0 rounded-full", colorOf(item.visit).dot)} />
                    )}
                    {item.visit.allDay ? null : (
                      <span className="text-muted-foreground shrink-0 tabular-nums">
                        {shortTime(new Date(item.visit.startsAt!))}
                      </span>
                    )}
                    <span className="truncate">{item.visit.title}</span>
                  </button>
                ) : item.task ? (
                  <button
                    key={item.key}
                    type="button"
                    onClick={(event) => onOpenTask(item.task!, { x: event.clientX, y: event.clientY })}
                    className={cn(
                      "hover:bg-muted flex min-w-0 items-center gap-1 rounded border px-1 text-left text-[11px] leading-5",
                      item.task.status === "done" && "text-muted-foreground line-through"
                    )}
                  >
                    <StatusIcon status={item.task.status} className="size-3" />
                    <span className="truncate">{item.task.title}</span>
                  </button>
                ) : (
                  <button
                    key={item.key}
                    type="button"
                    onClick={(event) =>
                      onOpenInspection(item.inspection!, { x: event.clientX, y: event.clientY })
                    }
                    className="border-foreground/30 hover:bg-muted flex min-w-0 items-center gap-1 rounded border border-dashed px-1 text-left text-[11px] leading-5"
                  >
                    <ShieldCheck className="size-3 shrink-0" />
                    <span className="truncate">
                      {item.inspection!.type.replace(/_/g, "-")} inspection
                    </span>
                  </button>
                )
              )}

              {extra > 0 ? (
                <button
                  type="button"
                  onClick={() => onPickDay(day)}
                  className="text-muted-foreground hover:text-foreground rounded px-1 text-left text-[11px] leading-5 font-medium"
                >
                  +{extra + 1} more
                </button>
              ) : null}
            </div>
          );
        })}
      </div>
    </div>
  );
}

type DayItem = {
  key: string;
  sort: number;
  visit?: ScheduleVisit;
  inspection?: ScheduleInspection;
  task?: ScheduleTask;
};

/** What's on one day: all-day things first, then by start time. */
function onDay(
  day: Date,
  visits: ScheduleVisit[],
  inspections: ScheduleInspection[],
  tasks: ScheduleTask[]
): DayItem[] {
  const iso = toISODate(day);
  const start = startOfDay(day);
  const end = addDays(start, 1);

  return [
    ...visits
      .filter((visit) =>
        visit.allDay
          ? visit.startsOn! <= iso && visit.endsOn! >= iso
          : new Date(visit.startsAt!) < end && new Date(visit.endsAt!) > start
      )
      .map((visit) => ({
        key: visit.id,
        sort: visit.allDay ? -1 : new Date(visit.startsAt!).getTime(),
        visit,
      })),
    ...inspections
      .filter((inspection) => inspection.on === iso)
      .map((inspection) => ({ key: `inspection-${inspection.id}`, sort: -1, inspection })),
    ...tasks
      .filter((task) => task.dueOn === iso)
      .map((task) => ({ key: `task-${task.id}`, sort: -1, task })),
  ].sort((a, b) => a.sort - b.sort);
}

/** "8a", "1:30p" — a month square has no room for "AM". */
function shortTime(date: Date) {
  return timeLabel(date).replace(" AM", "a").replace(" PM", "p");
}
