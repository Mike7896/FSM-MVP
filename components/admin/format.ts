import type { Row } from "@/lib/admin/metrics";

/** Formatting for the admin dashboard — compact, and never "NaN". */

export function money(cents: unknown) {
  const value = Number(cents ?? 0) / 100;
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: Math.abs(value) >= 1000 ? 0 : 2,
    minimumFractionDigits: 0,
  }).format(Number.isFinite(value) ? value : 0);
}

export function num(value: unknown) {
  const n = Number(value ?? 0);
  return Number.isFinite(n) ? n.toLocaleString("en-US") : "0";
}

export function pct(part: unknown, whole: unknown) {
  const p = Number(part ?? 0);
  const w = Number(whole ?? 0);
  return w > 0 ? `${Math.round((p / w) * 100)}%` : "—";
}

/** "just now", "4m", "3h", "2d" — against a ticking clock. */
export function ago(value: unknown, now: number) {
  if (!value) return "—";
  const then = new Date(String(value)).getTime();
  if (!Number.isFinite(then)) return "—";
  const seconds = Math.max(0, Math.round((now - then) / 1000));
  if (seconds < 45) return "just now";
  if (seconds < 3600) return `${Math.round(seconds / 60)}m ago`;
  if (seconds < 86_400) return `${Math.round(seconds / 3600)}h ago`;
  return `${Math.round(seconds / 86_400)}d ago`;
}

export function when(value: unknown) {
  if (!value) return "—";
  const date = new Date(String(value));
  return Number.isFinite(date.getTime())
    ? date.toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })
    : "—";
}

export function text(row: Row | undefined, key: string) {
  const value = row?.[key];
  return value === null || value === undefined ? "" : String(value);
}

export function n(row: Row | undefined, key: string) {
  const value = Number(row?.[key] ?? 0);
  return Number.isFinite(value) ? value : 0;
}

/** The later of two timestamps, either of which may be missing. */
export function latest(a: unknown, b: unknown) {
  const time = (value: unknown) => (value ? new Date(String(value)).getTime() : NaN);
  const [x, y] = [time(a), time(b)];
  if (!Number.isFinite(x)) return Number.isFinite(y) ? b : null;
  if (!Number.isFinite(y)) return a;
  return x >= y ? a : b;
}
