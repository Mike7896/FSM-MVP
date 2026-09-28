import { sql } from "drizzle-orm";
import {
  pgTable,
  uuid,
  text,
  uniqueIndex,
  check,
  index,
} from "drizzle-orm/pg-core";
import { organizations, customers } from "./office";
import { jobs } from "./jobs";
import { documents } from "./document-spine";
import { tasks } from "./tasks";

export const tags = pgTable(
  "tags",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    color: text("color").notNull().default("blue"),
  },
  (t) => [
    uniqueIndex("tags_org_name_unique").on(
      t.organizationId,
      sql`lower(${t.name})`,
    ),
    check("tags_name_check", sql`length(btrim(${t.name})) between 1 and 40`),
    check(
      "tags_color_check",
      sql`${t.color} in ('slate','blue','violet','pink','red','orange','amber','green','teal')`,
    ),
  ],
);

export const tagAssignments = pgTable(
  "tag_assignments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tagId: uuid("tag_id")
      .notNull()
      .references(() => tags.id, { onDelete: "cascade" }),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    jobId: uuid("job_id").references(() => jobs.id, { onDelete: "cascade" }),
    quoteId: uuid("quote_id").references(() => documents.id, {
      onDelete: "cascade",
    }),
    customerId: uuid("customer_id").references(() => customers.id, {
      onDelete: "cascade",
    }),
    taskId: uuid("task_id").references(() => tasks.id, {
      onDelete: "cascade",
    }),
  },
  (t) => [
    check(
      "tag_assignment_one_target",
      sql`num_nonnulls(${t.jobId}, ${t.quoteId}, ${t.customerId}, ${t.taskId}) = 1`,
    ),
    uniqueIndex("tag_job_unique").on(t.jobId, t.tagId),
    uniqueIndex("tag_quote_unique").on(t.quoteId, t.tagId),
    uniqueIndex("tag_customer_unique").on(t.customerId, t.tagId),
    uniqueIndex("tag_task_unique").on(t.taskId, t.tagId),
    index("tag_assignments_org_idx").on(t.organizationId),
    index("tag_assignments_tag_idx").on(t.tagId),
  ],
);
