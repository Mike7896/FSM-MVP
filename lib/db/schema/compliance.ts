import { relations } from "drizzle-orm";
import {
  date,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";

import {
  inspectionResultEnum,
  inspectionTypeEnum,
  permitPullerEnum,
  permitStatusEnum,
} from "./enums";
import { scopeNodes } from "./document-spine";
import { jobs } from "./jobs";
import { licenses } from "./office";

/**
 * COMPLIANCE — Object Model §5.5.
 *
 * The product **tracks** permits; it does not **file** them. Filing means
 * integrating with a specific authority having jurisdiction, and there are tens
 * of thousands of them with no common interface.
 *
 * **Permit and License are different objects in different trees.** A License is
 * a credential the shop holds, renewed on a calendar, outliving every job. A
 * Permit is authorization for one piece of work at one address, consumed by the
 * job, closed when the final inspection passes. They connect at exactly one
 * point: the jurisdiction.
 */
export const permits = pgTable(
  "permits",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    jobId: uuid("job_id")
      .notNull()
      .references(() => jobs.id, { onDelete: "cascade" }),

    jurisdiction: text("jurisdiction").notNull(),
    type: text("type"),
    /** Absent until the authority issues it — `needed` and `applied` precede it. */
    number: text("number"),
    scopeCovered: text("scope_covered"),
    status: permitStatusEnum("status").notNull().default("needed"),

    /**
     * Who pulls it varies by jurisdiction, so this is an attribute rather than
     * an assumption. A homeowner-pulled permit is a supported state.
     */
    pulledBy: permitPullerEnum("pulled_by").notNull().default("shop"),

    /** The license that authorized it — matched on jurisdiction. */
    licenseId: uuid("license_id").references(() => licenses.id, {
      onDelete: "set null",
    }),

    /**
     * What the shop actually paid, kept separate from the Line item that
     * charged the customer. Conflating them is how a paid permit line ends up
     * with no permit behind it.
     */
    feePaidCents: integer("fee_paid_cents"),
    /** The Scope row that charged the customer for it. */
    feeScopeNodeId: uuid("fee_scope_node_id").references(() => scopeNodes.id, {
      onDelete: "set null",
    }),

    appliedOn: date("applied_on"),
    issuedOn: date("issued_on"),
    /** Permits expire on inactivity, not a fixed clock — commonly ~180 days. */
    expiresOn: date("expires_on"),
    placardUrl: text("placard_url"),

    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("permits_job_id_idx").on(t.jobId),
    index("permits_status_idx").on(t.status),
  ]
);

/**
 * A scheduled visit that passes or fails a stage of the work. **Nested inside
 * the Permit**, not a sibling of it — it has no life outside the permit that
 * scheduled it, the same relationship a Line item has to a Quote. Modeling it
 * top-level would produce an inspection list nobody navigates to.
 *
 * `clearsPhase` is load-bearing: a passing rough-in inspection and a completed
 * phase are frequently the same moment, and that is exactly when a contractor
 * is entitled to a draw.
 */
export const inspections = pgTable(
  "inspections",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    permitId: uuid("permit_id")
      .notNull()
      .references(() => permits.id, { onDelete: "cascade" }),
    jobId: uuid("job_id")
      .notNull()
      .references(() => jobs.id, { onDelete: "cascade" }),

    type: inspectionTypeEnum("type").notNull(),
    result: inspectionResultEnum("result").notNull().default("scheduled"),

    requestedOn: date("requested_on"),
    scheduledOn: date("scheduled_on"),
    completedOn: date("completed_on"),

    inspectorNotes: text("inspector_notes"),
    correctionsRequired: text("corrections_required"),
    reinspectionFeeCents: integer("reinspection_fee_cents"),

    /** The phase this passing result completes, if any. */
    clearsPhase: text("clears_phase"),

    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("inspections_permit_id_idx").on(t.permitId),
    index("inspections_job_id_idx").on(t.jobId),
  ]
);

export const permitsRelations = relations(permits, ({ one, many }) => ({
  job: one(jobs, { fields: [permits.jobId], references: [jobs.id] }),
  license: one(licenses, {
    fields: [permits.licenseId],
    references: [licenses.id],
  }),
  inspections: many(inspections),
}));

export const inspectionsRelations = relations(inspections, ({ one }) => ({
  permit: one(permits, {
    fields: [inspections.permitId],
    references: [permits.id],
  }),
  job: one(jobs, { fields: [inspections.jobId], references: [jobs.id] }),
}));

export type Permit = typeof permits.$inferSelect;
export type Inspection = typeof inspections.$inferSelect;
