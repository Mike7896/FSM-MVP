/**
 * FREE TIME — the date math behind "add a couple of months", shared by the
 * panel's preview and anything else that needs it, so what an admin sees
 * before saving is exactly the day that's saved.
 *
 * Days are "YYYY-MM-DD", the same as `account_policies.access_until`.
 */

type Policy = { kind: "standard" | "tester"; compPlan: boolean; accessUntil: string | null } | null;

/** Today on this computer's calendar, as a day. */
export function today() {
  const date = new Date();
  return [date.getFullYear(), String(date.getMonth() + 1).padStart(2, "0"), String(date.getDate()).padStart(2, "0")].join("-");
}

/**
 * The day their free time (or a tester's access) runs through now — null when
 * there's none, or it has no end.
 */
export function freeTimeEnd(policy: Policy) {
  if (!policy || !(policy.compPlan || policy.kind === "tester")) return null;
  return policy.accessUntil;
}

/** Free time with no end date: there's nothing to add months to. */
export function freeTimeOpenEnded(policy: Policy) {
  return Boolean(policy?.compPlan && !policy.accessUntil);
}

/**
 * Where added months count from: the current last day while it's still
 * coming, else today — so time added to a free period that already ended
 * isn't spent before it starts.
 */
export function extendFrom(policy: Policy, now = today()) {
  const end = freeTimeEnd(policy);
  return end && end >= now ? end : now;
}

/** A day plus some months; the 31st lands on the month's last day when it's shorter. */
export function addMonths(day: string, months: number) {
  const [year, month, date] = day.split("-").map(Number);
  const target = new Date(Date.UTC(year, month - 1 + months, 1));
  const last = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
  target.setUTCDate(Math.min(date, last));
  return target.toISOString().slice(0, 10);
}

/** Whole days from one day to another. */
export function daysBetween(from: string, to: string) {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);
}
