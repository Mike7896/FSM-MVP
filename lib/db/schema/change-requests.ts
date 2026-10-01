import { index, integer, jsonb, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { documents } from "./document-spine";

/** Customer requests are proposals, never an agreement or a charge. */
export const changeRequests = pgTable("change_requests", {
  id: uuid("id").primaryKey(),
  contractId: uuid("contract_id").notNull().references(() => documents.id, { onDelete: "cascade" }),
  body: text("body").notNull().default(""),
  photoPaths: jsonb("photo_paths").$type<string[]>().notNull().default([]),
  uploadCount: integer("upload_count").notNull().default(0),
  submittedAt: timestamp("submitted_at", { withTimezone: true }),
  changeOrderId: uuid("change_order_id").references(() => documents.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, t => [index("change_requests_contract_idx").on(t.contractId)]);
