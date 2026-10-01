import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  date,
  index,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";

import { authUsers } from "./auth";
import { jobs } from "./jobs";
import { organizations } from "./office";
import { tasks } from "./tasks";

/**
 * THE SCHEDULE — who is where, when.
 *
 * **A Visit is the object** (Object Model §7's "a visit": one relationship to
 * the Job, not a redesign). It is time booked against a job — the work itself,
 * or the estimate visit before there is a quote — or time that isn't anyone's
 * job at all: a day off, a supply run.
 *
 * **Inspections are not copied in here.** They already carry their own date,
 * on the permit that requires them, and the schedule reads them from there. A
 * second row for the same inspection is two dates that can disagree.
 */

/**
 * What the time is for.
 *
 * - `work` — on the job, doing it.
 * - `estimate` — at the job before it's quoted: measuring, looking.
 * - `time_off` — a person isn't available. Booking them over it warns.
 * - `other` — a supply run, a meeting, the truck in the shop.
 */
export const visitKindEnum = pgEnum("visit_kind", [
  "work",
  "estimate",
  "time_off",
  "other",
]);

export const visitStatusEnum = pgEnum("visit_status", [
  "scheduled",
  "done",
  "cancelled",
]);

export const visits = pgTable(
  "visits",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    /** Required for work and estimates; a day off belongs to no job. */
    jobId: uuid("job_id").references(() => jobs.id, { onDelete: "cascade" }),
    kind: visitKindEnum("kind").notNull().default("work"),
    /**
     * The task this time was booked to get done, when it was. The task keeps
     * living if the visit goes, and the visit stays booked if the task does.
     */
    taskId: uuid("task_id").references(() => tasks.id, { onDelete: "set null" }),
    /** "Rough-in", "Trim-out". Left empty, the job's own name stands in. */
    title: text("title"),
    notes: text("notes"),

    /**
     * **Two shapes of time, never both.** A timed visit is an instant range in
     * `starts_at`/`ends_at`, the same moment for everyone wherever they are. An
     * all-day one is a range of calendar dates, inclusive — "Tuesday" is
     * Tuesday on the contractor's wall calendar, not a 24-hour window in UTC
     * that lands half on Monday for someone in California.
     */
    allDay: boolean("all_day").notNull().default(false),
    startsAt: timestamp("starts_at", { withTimezone: true }),
    endsAt: timestamp("ends_at", { withTimezone: true }),
    startsOn: date("starts_on"),
    endsOn: date("ends_on"),

    status: visitStatusEnum("status").notNull().default("scheduled"),

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
    index("visits_org_starts_at_idx").on(t.organizationId, t.startsAt),
    index("visits_org_starts_on_idx").on(t.organizationId, t.startsOn),
    index("visits_job_idx").on(t.jobId),
    index("visits_task_idx").on(t.taskId),
    check(
      "visits_time_shape",
      sql`(${t.allDay} and ${t.startsOn} is not null and ${t.endsOn} is not null and ${t.endsOn} >= ${t.startsOn} and ${t.startsAt} is null and ${t.endsAt} is null)
        or (not ${t.allDay} and ${t.startsAt} is not null and ${t.endsAt} is not null and ${t.endsAt} > ${t.startsAt} and ${t.startsOn} is null and ${t.endsOn} is null)`
    ),
    check(
      "visits_job_for_job_work",
      sql`${t.kind} not in ('work', 'estimate') or ${t.jobId} is not null`
    ),
  ]
);

/** Who is on a visit. A visit with nobody is booked but not yet staffed. */
export const visitAssignees = pgTable(
  "visit_assignees",
  {
    visitId: uuid("visit_id")
      .notNull()
      .references(() => visits.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => authUsers.id, { onDelete: "cascade" }),
  },
  (t) => [
    primaryKey({ columns: [t.visitId, t.userId] }),
    index("visit_assignees_user_idx").on(t.userId),
  ]
);

export type Visit = typeof visits.$inferSelect;
