import { visitKind, type VisitKind } from "./types";

/**
 * What the calendar prints for a visit. Its own title when it has one;
 * otherwise who and what — "Petersen · Panel upgrade" — which is how a
 * contractor says a job out loud.
 *
 * No I/O, so the schedule and the notifications both word it the same way
 * without importing each other.
 */
export function titleOf(
  kind: VisitKind,
  title: string | null,
  jobName: string | null,
  customerName: string | null
) {
  if (title?.trim()) return title.trim();
  const who = customerName?.trim().split(/\s+/).at(-1);
  const what = jobName?.trim();
  const job = [who, what].filter(Boolean).join(" · ");
  if (kind === "estimate") return job ? `Estimate · ${job}` : "Estimate visit";
  return job || visitKind(kind).label;
}
