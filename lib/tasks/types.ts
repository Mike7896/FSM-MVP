import type { ScheduleJob } from "@/lib/schedule/types";
import type { Tag } from "@/lib/tags";

/**
 * Tasks as the page and the API see them. No server imports: the board, the
 * list and the job's panel read the same words and the same order.
 */

export type TaskStatus = "backlog" | "todo" | "in_progress" | "done" | "cancelled";
export type TaskPriority = "none" | "urgent" | "high" | "medium" | "low";

/** In the order a task moves through them — the board's columns, left to right. */
export const TASK_STATUSES: { status: TaskStatus; label: string }[] = [
  { status: "backlog", label: "Backlog" },
  { status: "todo", label: "To do" },
  { status: "in_progress", label: "In progress" },
  { status: "done", label: "Done" },
  { status: "cancelled", label: "Cancelled" },
];

/** Most pressing first; "no priority" last, because nobody has said. */
export const TASK_PRIORITIES: { priority: TaskPriority; label: string }[] = [
  { priority: "urgent", label: "Urgent" },
  { priority: "high", label: "High" },
  { priority: "medium", label: "Medium" },
  { priority: "low", label: "Low" },
  { priority: "none", label: "No priority" },
];

export function statusLabel(status: TaskStatus) {
  return TASK_STATUSES.find((entry) => entry.status === status)!.label;
}

export function priorityLabel(priority: TaskPriority) {
  return TASK_PRIORITIES.find((entry) => entry.priority === priority)!.label;
}

/** Finished one way or the other — off the list of things still to do. */
export function isClosed(status: TaskStatus) {
  return status === "done" || status === "cancelled";
}

/** "T-14" — short enough to say out loud, and never mistaken for job #14. */
export function taskKey(number: number) {
  return `T-${number}`;
}

/** The next time booked on the schedule to get it done. */
export type TaskBooking = {
  visitId: string;
  allDay: boolean;
  startsAt: string | null;
  startsOn: string | null;
};

export type TaskView = {
  id: string;
  number: number;
  title: string;
  description: string | null;
  status: TaskStatus;
  priority: TaskPriority;
  assigneeId: string | null;
  /** `YYYY-MM-DD`, a day on the wall calendar. */
  dueOn: string | null;
  position: number;
  completedAt: string | null;
  createdAt: string;
  job: (ScheduleJob & { demo: boolean }) | null;
  tags: Tag[];
  nextBooking: TaskBooking | null;
};

/** One task opened up: everything on it, and every visit booked for it. */
export type TaskDetail = TaskView & {
  createdByName: string | null;
  visits: {
    id: string;
    title: string;
    status: "scheduled" | "done" | "cancelled";
    allDay: boolean;
    startsAt: string | null;
    endsAt: string | null;
    startsOn: string | null;
    endsOn: string | null;
  }[];
};
