import { relations } from "drizzle-orm";
import {
  index,
  integer,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

import { documents } from "./document-spine";
import { drawGateEnum, inspectionTypeEnum } from "./enums";
import { jobs } from "./jobs";

/**
 * **What the job's money is going to do, before it does it.**
 *
 * The Job hub's spine is "the money, in order" — deposit paid, rough-in ready to
 * bill, trim and final still gated — and every row after the first describes
 * money that has *no invoice yet*. Without somewhere to keep them, the hub can
 * only list invoices that already exist, which on a job with a paid deposit is
 * one row and no answer to "what's next".
 *
 * **It is a plan, not a document.** Nobody signs it and the homeowner never sees
 * it; the Contract is what she agreed to, and this is the shop's reading of how
 * that agreement gets billed. That is why it hangs off the Job with a nullable
 * contract rather than being part of the Contract itself — a job billed in
 * stages with nothing signed yet is a real state.
 *
 * A row **becomes** an Invoice rather than duplicating one: `invoiceId` is null
 * until the phase is billed and points at the bill afterwards. Storing the
 * amount in both places and hoping they agree is how a draw gets billed twice.
 *
 * Both the agreement and the bill are documents on the spine, so both are real
 * foreign keys.
 */
export const drawSchedule = pgTable(
  "draw_schedule",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    jobId: uuid("job_id")
      .notNull()
      .references(() => jobs.id, { onDelete: "cascade" }),
    /** The agreement this schedule reads. Null while the job is pre-contract. */
    contractId: uuid("contract_id").references(() => documents.id, {
      onDelete: "set null",
    }),

    position: integer("position").notNull().default(0),
    /** What the contractor calls this stage — "Rough-in passed". */
    name: text("name").notNull(),
    amountCents: integer("amount_cents").notNull().default(0),

    /** What opens it. Named so the hub can say why a phase is still gated. */
    gate: drawGateEnum("gate").notNull().default("phase_complete"),
    /** Set when an inspection is what clears this stage. */
    inspectionType: inspectionTypeEnum("inspection_type"),

    /**
     * The quote phase this stage was planned from — its `key` in the quote's
     * `draw_pattern`, and so in the contract rows' `phase_key`. It is how the
     * job knows which rooms a phase covers. Null for a deposit, a final
     * balance, or a stage typed on the job.
     */
    phaseKey: text("phase_key"),

    /** The bill this became. Null until the phase is billed. */
    invoiceId: uuid("invoice_id").references(() => documents.id, {
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
    index("draw_schedule_job_id_idx").on(t.jobId),
    uniqueIndex("draw_schedule_job_position_unique").on(t.jobId, t.position),
  ]
);

export const drawScheduleRelations = relations(drawSchedule, ({ one }) => ({
  job: one(jobs, { fields: [drawSchedule.jobId], references: [jobs.id] }),
  contract: one(documents, {
    fields: [drawSchedule.contractId],
    references: [documents.id],
  }),
  invoice: one(documents, {
    fields: [drawSchedule.invoiceId],
    references: [documents.id],
  }),
}));

export type DrawScheduleRow = typeof drawSchedule.$inferSelect;
export type NewDrawScheduleRow = typeof drawSchedule.$inferInsert;
