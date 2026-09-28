import { index, integer, jsonb, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { documents } from "./document-spine";

export type InfoQuestion = { id: string; prompt: string };
export type InfoAnswer = { questionId: string; text: string };

/** Questions and replies belong to the quote, while photos also enter job capture. */
export const infoRequests = pgTable("info_requests", {
  id: uuid("id").primaryKey().defaultRandom(),
  documentId: uuid("document_id").notNull().references(() => documents.id, { onDelete: "cascade" }),
  questions: jsonb("questions").$type<InfoQuestion[]>().notNull().default([]),
  photoPrompt: text("photo_prompt"),
  note: text("note"),
  answers: jsonb("answers").$type<InfoAnswer[]>().notNull().default([]),
  photoPaths: jsonb("photo_paths").$type<string[]>().notNull().default([]),
  uploadCount: integer("upload_count").notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  answeredAt: timestamp("answered_at", { withTimezone: true }),
  emailSentAt: timestamp("email_sent_at", { withTimezone: true }),
  recipient: text("recipient"),
}, table => [index("info_requests_document_idx").on(table.documentId)]);
