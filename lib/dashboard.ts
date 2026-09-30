/** Calendar dates are compared in the viewer's timezone, not the server's. */
export function dashboardDate(date: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone, year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(date);
  const part = (type: string) => parts.find((value) => value.type === type)!.value;
  return `${part("year")}-${part("month")}-${part("day")}`;
}

export function dashboardHorizon(today: string) {
  const date = new Date(`${today}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + 6);
  return date.toISOString().slice(0, 10);
}

/** A recent send/view is context; allow three days before suggesting a follow-up. */
export function quoteFollowUp(sentAt: Date | null, viewedAt: Date | null, viewTracking: boolean, now = Date.now()) {
  const lastActivity = viewTracking && viewedAt ? viewedAt : sentAt;
  return Boolean(lastActivity && now - lastActivity.getTime() >= 3 * 86_400_000);
}
