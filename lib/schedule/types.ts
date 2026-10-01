/**
 * The schedule's vocabulary — what the calendar draws and what the API speaks.
 *
 * Client-safe: the page imports this directly. No I/O, no server imports.
 */

export type VisitKind = "work" | "estimate" | "time_off" | "other";
export type VisitStatus = "scheduled" | "done" | "cancelled";

/**
 * The four kinds, in the order the picker offers them. The trade's words: a
 * contractor books *work* on a job and goes out to *estimate* one; nobody says
 * "appointment".
 */
export const VISIT_KINDS: {
  kind: VisitKind;
  label: string;
  /** Work and estimates happen at a job; the rest belong to no one's job. */
  needsJob: boolean;
}[] = [
  { kind: "work", label: "Job work", needsJob: true },
  { kind: "estimate", label: "Estimate visit", needsJob: true },
  { kind: "time_off", label: "Time off", needsJob: false },
  { kind: "other", label: "Other", needsJob: false },
];

export function visitKind(kind: VisitKind) {
  return VISIT_KINDS.find((entry) => entry.kind === kind)!;
}

/** The job a visit is at, as the calendar needs it. */
export type ScheduleJob = {
  id: string;
  number: number;
  name: string | null;
  customerName: string | null;
  address: string | null;
};

export type ScheduleVisit = {
  id: string;
  kind: VisitKind;
  status: VisitStatus;
  /** What the calendar prints — the visit's own title, or its job's. */
  title: string;
  /** The title as typed, null when the job's name stands in. */
  customTitle: string | null;
  notes: string | null;
  allDay: boolean;
  /** ISO instants for a timed visit. */
  startsAt: string | null;
  endsAt: string | null;
  /** ISO calendar dates, inclusive, for an all-day one. */
  startsOn: string | null;
  endsOn: string | null;
  job: ScheduleJob | null;
  assignees: string[];
  /** The task this time was booked to get done, when it was. */
  task: { id: string; number: number; title: string } | null;
};

/**
 * An inspection, read from the permit that requires it. On the calendar but
 * not moved from it — its date belongs to the permit.
 */
export type ScheduleInspection = {
  id: string;
  type: string;
  result: string;
  /** ISO calendar date. */
  on: string;
  permitId: string;
  job: ScheduleJob;
};

export type TeamMember = {
  userId: string;
  name: string;
  email: string;
  role: string;
};

/** Somebody booked twice — said, never refused. */
export type ScheduleConflict = {
  userId: string;
  visitId: string;
  title: string;
  kind: VisitKind;
};

/**
 * A task due on a day. On the calendar the way an inspection is: its date
 * belongs to the task, and it's changed there.
 */
export type ScheduleTask = {
  id: string;
  number: number;
  title: string;
  status: "backlog" | "todo" | "in_progress" | "done" | "cancelled";
  priority: "none" | "urgent" | "high" | "medium" | "low";
  /** ISO calendar date. */
  dueOn: string;
  assigneeId: string | null;
  job: ScheduleJob | null;
};

export type ScheduleRange = {
  visits: ScheduleVisit[];
  inspections: ScheduleInspection[];
  tasks: ScheduleTask[];
};
