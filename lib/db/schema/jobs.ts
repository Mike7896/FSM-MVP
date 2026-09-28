import { relations } from "drizzle-orm";
import {
  boolean,
  date,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

import { authUsers } from "./auth";
import { jobStatusEnum } from "./enums";
import { customers, organizations } from "./office";

/**
 * THE JOB TREE — Object Model §3.
 *
 * The container for one piece of work at one address, from first contact to
 * paid. Everything in this tree belongs to exactly one Job, and the Job is the
 * **only prerequisite anywhere** — it is created silently by whichever document
 * comes first, which is what makes every create path work from nothing.
 *
 * **The money state is not stored here.** Total, billed, collected, spent and
 * remaining are derived from the job's documents and payments. That is what
 * lets the Job hub read as the story of this job's money rather than as a form
 * somebody has to keep accurate — and it is why there are no `total` or
 * `collected` columns below.
 */
export const jobs = pgTable(
  "jobs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    customerId: uuid("customer_id")
      .notNull()
      .references(() => customers.id, { onDelete: "restrict" }),

    /** Human-facing sequential id, unique per organization (e.g. #1042). */
    number: integer("number").notNull().default(0),

    name: text("name"),
    description: text("description"),

    /**
     * The address the work happens at, and the attribute the whole compliance
     * story hangs off: **jurisdiction is derived from it**, and jurisdiction is
     * what a License and a Permit are matched on. It is the one attribute on a
     * Job that reaches into the Office.
     */
    address: text("address"),
    jurisdiction: text("jurisdiction"),

    status: jobStatusEnum("status").notNull().default("quoting"),

    /** The pack this job's documents were written under. */
    packId: text("pack_id"),

    /**
     * Built on the demo start. **A demo job is kept and never counted**: it
     * stays in the contractor's lists, labelled, and every count, gate, money
     * total and send limit leaves it out — a demo deposit is not revenue. Every
     * document on the job inherits it, because every document belongs to
     * exactly one job. Set at creation and never changed: a demo is not turned
     * into real work in place.
     */
    isDemo: boolean("is_demo").notNull().default(false),

    startsOn: date("starts_on"),
    endsOn: date("ends_on"),
    closedAt: timestamp("closed_at", { withTimezone: true }),

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
    uniqueIndex("jobs_org_number_unique").on(t.organizationId, t.number),
    index("jobs_organization_id_idx").on(t.organizationId),
    index("jobs_customer_id_idx").on(t.customerId),
    index("jobs_status_idx").on(t.organizationId, t.status),
    index("jobs_starts_on_idx").on(t.organizationId, t.startsOn),
  ]
);

export const jobsRelations = relations(jobs, ({ one }) => ({
  organization: one(organizations, {
    fields: [jobs.organizationId],
    references: [organizations.id],
  }),
  customer: one(customers, {
    fields: [jobs.customerId],
    references: [customers.id],
  }),
}));

export type Job = typeof jobs.$inferSelect;
export type NewJob = typeof jobs.$inferInsert;
