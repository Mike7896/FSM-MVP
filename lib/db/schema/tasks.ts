import { sql } from "drizzle-orm";
import {
  check,
  date,
  doublePrecision,
  index,
  integer,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

import { authUsers } from "./auth";
import { jobs } from "./jobs";
import { organizations } from "./office";

/**
 * TASKS — the things somebody has to do.
 *
 * **A Task is the object; the board and the list are views of it.** The Object
 * Model's rule holds: a *board* is a filtered list of something else, so there
 * is no board table — only tasks, drawn in columns by their status.
 *
 * **The Job is the project.** A task on a job belongs to that job and goes with
 * it; a task on no job belongs to the shop — renew the insurance, fix the van.
 * There is no separate "project" object, because a contractor's project already
 * has a name, an address and a customer: it's the job.
 */

/**
 * Where a task has got to. Closed set, in order.
 *
 * - `backlog` — known about, not planned yet.
 * - `todo` — planned, not started.
 * - `in_progress` — somebody's on it.
 * - `done` — finished.
 * - `cancelled` — not happening; kept so the record says so.
 */
export const taskStatusEnum = pgEnum("task_status", [
  "backlog",
  "todo",
  "in_progress",
  "done",
  "cancelled",
]);

/** How much it matters. `none` is a real answer: nobody has said. */
export const taskPriorityEnum = pgEnum("task_priority", [
  "none",
  "urgent",
  "high",
  "medium",
  "low",
]);

export const tasks = pgTable(
  "tasks",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    /** Per shop, like jobs — "task 14". Set by trigger on insert. */
    number: integer("number").notNull().default(0),
    /** The job it's part of. Empty, it's the shop's own. */
    jobId: uuid("job_id").references(() => jobs.id, { onDelete: "cascade" }),

    title: text("title").notNull(),
    description: text("description"),
    status: taskStatusEnum("status").notNull().default("todo"),
    priority: taskPriorityEnum("priority").notNull().default("none"),
    /** One person owns it. Nobody is a real state: it's up for grabs. */
    assigneeId: uuid("assignee_id").references(() => authUsers.id, {
      onDelete: "set null",
    }),
    /** A calendar date on the shop's wall, not an instant. */
    dueOn: date("due_on"),
    /**
     * Its place in its column. Fractional, so a drag between two cards writes
     * one row — the midpoint — instead of renumbering the column.
     */
    position: doublePrecision("position").notNull().default(0),
    /** When it last became done; cleared if it's reopened. */
    completedAt: timestamp("completed_at", { withTimezone: true }),

    createdBy: uuid("created_by").references(() => authUsers.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex("tasks_org_number_unique").on(t.organizationId, t.number),
    index("tasks_org_status_position_idx").on(t.organizationId, t.status, t.position),
    index("tasks_job_idx").on(t.jobId),
    index("tasks_assignee_idx").on(t.assigneeId),
    index("tasks_org_due_on_idx").on(t.organizationId, t.dueOn),
    check("tasks_title_check", sql`length(btrim(${t.title})) between 1 and 200`),
  ]
);

export type Task = typeof tasks.$inferSelect;
