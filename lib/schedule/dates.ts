/**
 * Calendar arithmetic on the viewer's own clock.
 *
 * Everything here works in the browser's local time: a calendar is read on a
 * wall, and "Tuesday 8 am" means the viewer's Tuesday. Dates cross the wire as
 * `YYYY-MM-DD` and instants as ISO strings; nothing here assumes UTC.
 *
 * Weeks start on Sunday, the way a US contractor's paper calendar does.
 */

export type ScheduleView = "day" | "week" | "month";

export function startOfDay(date: Date): Date {
  const copy = new Date(date);
  copy.setHours(0, 0, 0, 0);
  return copy;
}

export function addDays(date: Date, days: number): Date {
  const copy = new Date(date);
  copy.setDate(copy.getDate() + days);
  return copy;
}

export function addMonths(date: Date, months: number): Date {
  const copy = new Date(date);
  const day = copy.getDate();
  copy.setDate(1);
  copy.setMonth(copy.getMonth() + months);
  // Jan 31 + 1 month is the last day of February, not March 3.
  const last = new Date(copy.getFullYear(), copy.getMonth() + 1, 0).getDate();
  copy.setDate(Math.min(day, last));
  return copy;
}

export function startOfWeek(date: Date): Date {
  const day = startOfDay(date);
  return addDays(day, -day.getDay());
}

export function sameDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

/** `2026-09-24`, on the local calendar. */
export function toISODate(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

/** `2026-09-24` → local midnight that day. */
export function fromISODate(value: string): Date {
  const [y, m, d] = value.split("-").map(Number);
  return new Date(y, m - 1, d);
}

/** The days a view shows: one, seven, or the six weeks around a month. */
export function viewDays(view: ScheduleView, anchor: Date): Date[] {
  if (view === "day") return [startOfDay(anchor)];
  if (view === "week") {
    const first = startOfWeek(anchor);
    return Array.from({ length: 7 }, (_, index) => addDays(first, index));
  }
  const first = startOfWeek(new Date(anchor.getFullYear(), anchor.getMonth(), 1));
  return Array.from({ length: 42 }, (_, index) => addDays(first, index));
}

/** Where "next" and "previous" go from here. */
export function step(view: ScheduleView, anchor: Date, direction: 1 | -1): Date {
  if (view === "day") return addDays(anchor, direction);
  if (view === "week") return addDays(anchor, 7 * direction);
  return addMonths(anchor, direction);
}

/**
 * The heading over the grid — "September 2026", "Sep 20 – 26, 2026".
 * `short` is for a phone's toolbar: "Sep 2026", "Wed, Sep 23", "Sep 20 – 26".
 */
export function rangeLabel(view: ScheduleView, anchor: Date, short = false): string {
  if (view === "month") {
    return anchor.toLocaleDateString("en-US", {
      month: short ? "short" : "long",
      year: "numeric",
    });
  }
  if (view === "day") {
    return short
      ? anchor.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" })
      : anchor.toLocaleDateString("en-US", {
          weekday: "long",
          month: "long",
          day: "numeric",
          year: "numeric",
        });
  }
  const days = viewDays("week", anchor);
  const first = days[0];
  const last = days[6];
  const sameMonth = first.getMonth() === last.getMonth();
  const sameYear = first.getFullYear() === last.getFullYear();
  const month = (date: Date) => date.toLocaleDateString("en-US", { month: "short" });
  // Assembled by hand: `toLocaleDateString` asked for a day and a year with
  // no month answers "2026 (day: 26)".
  const left = `${month(first)} ${first.getDate()}${sameYear ? "" : `, ${first.getFullYear()}`}`;
  const right = `${sameMonth ? "" : `${month(last)} `}${last.getDate()}${short ? "" : `, ${last.getFullYear()}`}`;
  return `${left} – ${right}`;
}

/** "8 AM", "8:30 AM". */
export function timeLabel(date: Date): string {
  return date.toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: date.getMinutes() ? "2-digit" : undefined,
  });
}

/** "8 – 11:30 AM", "11 AM – 1 PM". */
export function timeRangeLabel(start: Date, end: Date): string {
  const samePeriod = (start.getHours() < 12) === (end.getHours() < 12);
  const left = start
    .toLocaleTimeString("en-US", {
      hour: "numeric",
      minute: start.getMinutes() ? "2-digit" : undefined,
    })
    .replace(samePeriod ? / (AM|PM)$/ : /$^/, "");
  return `${left} – ${timeLabel(end)}`;
}

/** Minutes since local midnight. */
export function minutesOfDay(date: Date): number {
  return date.getHours() * 60 + date.getMinutes();
}

/** A local day plus minutes past midnight, as an instant. */
export function atMinutes(day: Date, minutes: number): Date {
  const at = startOfDay(day);
  at.setMinutes(minutes);
  return at;
}

/** The hours 0–23 as the grid's gutter prints them. */
export function hourLabel(hour: number): string {
  if (hour === 0) return "";
  const suffix = hour < 12 ? "AM" : "PM";
  const twelve = hour % 12 === 0 ? 12 : hour % 12;
  return `${twelve} ${suffix}`;
}
