/**
 * What time it is for one person — for quiet hours and the summary hour.
 *
 * Both settings are hours on *their* clock, in the time zone their browser
 * reported when they saved them. No I/O, no dependencies: `Intl` already knows
 * every zone.
 */

/** The hour and minute it is at `date` in `timeZone`. */
export function localTime(
  date: Date,
  timeZone: string | null
): { hour: number; minute: number } {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: timeZone ?? "UTC",
    hour: "numeric",
    minute: "numeric",
    hourCycle: "h23",
  }).formatToParts(date);

  const read = (type: "hour" | "minute") =>
    Number(parts.find((part) => part.type === type)?.value ?? 0);

  return { hour: read("hour") % 24, minute: read("minute") };
}

/** The next moment their clock reads `hour`:00 — later today, or tomorrow. */
export function nextLocalHour(
  date: Date,
  timeZone: string | null,
  hour: number
): Date {
  const now = localTime(date, timeZone);
  let minutes = hour * 60 - (now.hour * 60 + now.minute);
  if (minutes <= 0) minutes += 24 * 60;
  const at = new Date(date.getTime() + minutes * 60_000);
  at.setSeconds(0, 0);
  return at;
}

/**
 * Whether `date` falls inside quiet hours that run from `start` to `end` on
 * their clock. Quiet hours usually cross midnight — 21 to 7 — and a start
 * equal to the end means no quiet hours at all.
 */
export function inQuietHours(
  date: Date,
  timeZone: string | null,
  start: number,
  end: number
): boolean {
  if (start === end) return false;
  const { hour } = localTime(date, timeZone);
  return start < end ? hour >= start && hour < end : hour >= start || hour < end;
}
