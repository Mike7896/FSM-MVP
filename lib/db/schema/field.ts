import { relations } from "drizzle-orm";
import {
  boolean,
  date,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";

import { authUsers } from "./auth";
import { documents } from "./document-spine";
import { drawSchedule } from "./draws";
import { captureKindEnum } from "./enums";
import { jobs } from "./jobs";

/**
 * INTERNAL ARTIFACTS — Object Model §5.6.
 *
 * What the contractor recorded in the field. Internal by default; Evidence is
 * the one that becomes customer-facing, and only once it is sent.
 */

/**
 * What was captured while walking the job — **before there is a quote to
 * attach it to.** That is why it is its own object: forcing capture into the
 * quote would mean nothing can be recorded until pricing has started, which is
 * backwards from how a walkthrough actually goes.
 */
export const captureArtifacts = pgTable(
  "capture_artifacts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    jobId: uuid("job_id")
      .notNull()
      .references(() => jobs.id, { onDelete: "cascade" }),

    kind: captureKindEnum("kind").notNull(),
    /** Note text, measurement value, or transcript — whichever the kind implies. */
    body: text("body"),
    fileUrl: text("file_url"),

    /** Free-text flags set with one tap on site, e.g. "for insurance". */
    flag: text("flag"),
    locationLat: text("location_lat"),
    locationLng: text("location_lng"),

    capturedAt: timestamp("captured_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    capturedBy: uuid("captured_by").references(() => authUsers.id, {
      onDelete: "set null",
    }),

    usedInQuote: boolean("used_in_quote").notNull().default(false),
    promotedToEvidenceId: uuid("promoted_to_evidence_id"),
  },
  (t) => [index("capture_artifacts_job_id_idx").on(t.jobId)]
);

/**
 * Proof that a phase of work is complete, attached to the draw it unlocks.
 *
 * A first-class object rather than an attachment field, because it is what
 * makes a mid-job money ask land as *expected* rather than alarming.
 */
export const evidence = pgTable(
  "evidence",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    jobId: uuid("job_id")
      .notNull()
      .references(() => jobs.id, { onDelete: "cascade" }),
    /** The draw this unlocks. Null until it is billed. */
    invoiceId: uuid("invoice_id").references(() => documents.id, {
      onDelete: "set null",
    }),
    /**
     * The planned phase this proves. Matching on the name broke the moment a
     * phase was renamed. Null on evidence recorded before phases had ids.
     */
    drawScheduleId: uuid("draw_schedule_id").references(() => drawSchedule.id, {
      onDelete: "set null",
    }),

    phaseName: text("phase_name").notNull(),
    summary: text("summary"),

    completedAt: timestamp("completed_at", { withTimezone: true }),
    sentAt: timestamp("sent_at", { withTimezone: true }),
    approvedAt: timestamp("approved_at", { withTimezone: true }),

    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("evidence_job_id_idx").on(t.jobId),
    index("evidence_invoice_id_idx").on(t.invoiceId),
    index("evidence_draw_schedule_id_idx").on(t.drawScheduleId),
  ]
);

/** Photos belonging to one piece of evidence. */
export const evidencePhotos = pgTable(
  "evidence_photos",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    evidenceId: uuid("evidence_id")
      .notNull()
      .references(() => evidence.id, { onDelete: "cascade" }),
    fileUrl: text("file_url").notNull(),
    caption: text("caption"),
    position: integer("position").notNull().default(0),
  },
  (t) => [index("evidence_photos_evidence_id_idx").on(t.evidenceId)]
);

/**
 * What was spent on this job, so the contractor's material cost is a real
 * number rather than a memory.
 */
export const receipts = pgTable(
  "receipts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    jobId: uuid("job_id")
      .notNull()
      .references(() => jobs.id, { onDelete: "cascade" }),

    vendor: text("vendor"),
    amountCents: integer("amount_cents").notNull(),
    description: text("description"),
    category: text("category"),
    imageUrl: text("image_url"),
    purchasedOn: date("purchased_on"),
    reconciled: boolean("reconciled").notNull().default(false),

    capturedAt: timestamp("captured_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    capturedBy: uuid("captured_by").references(() => authUsers.id, {
      onDelete: "set null",
    }),
  },
  (t) => [index("receipts_job_id_idx").on(t.jobId)]
);

/**
 * Job talk kept attached to the job rather than scattered across a text thread.
 *
 * **The thread's lifetime is the job's**: it opens when the Contract is signed,
 * runs while work is underway, and becomes read-only history when the job
 * closes. An always-open channel to every past customer is a support obligation
 * the shop did not sign up for.
 */
export const messages = pgTable(
  "messages",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    jobId: uuid("job_id")
      .notNull()
      .references(() => jobs.id, { onDelete: "cascade" }),

    body: text("body").notNull(),
    /** Null when the homeowner wrote it — she has no account to reference. */
    senderUserId: uuid("sender_user_id").references(() => authUsers.id, {
      onDelete: "set null",
    }),
    fromHomeowner: boolean("from_homeowner").notNull().default(false),
    readAt: timestamp("read_at", { withTimezone: true }),

    sentAt: timestamp("sent_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("messages_job_id_idx").on(t.jobId)]
);

export const captureArtifactsRelations = relations(
  captureArtifacts,
  ({ one }) => ({
    job: one(jobs, { fields: [captureArtifacts.jobId], references: [jobs.id] }),
  })
);

export const evidenceRelations = relations(evidence, ({ one, many }) => ({
  job: one(jobs, { fields: [evidence.jobId], references: [jobs.id] }),
  invoice: one(documents, {
    fields: [evidence.invoiceId],
    references: [documents.id],
  }),
  photos: many(evidencePhotos),
}));

export const receiptsRelations = relations(receipts, ({ one }) => ({
  job: one(jobs, { fields: [receipts.jobId], references: [jobs.id] }),
}));

export const messagesRelations = relations(messages, ({ one }) => ({
  job: one(jobs, { fields: [messages.jobId], references: [jobs.id] }),
}));

export type CaptureArtifact = typeof captureArtifacts.$inferSelect;
export type Evidence = typeof evidence.$inferSelect;
export type Receipt = typeof receipts.$inferSelect;
export type Message = typeof messages.$inferSelect;
