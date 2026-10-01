import { index, jsonb, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { authUsers } from "./auth";
import { supportRequests } from "./support";
import type { BuildItem } from "@/lib/release-notes/entries";

export const productReleases = pgTable("product_releases", {
  id: uuid("id").primaryKey().defaultRandom(),
  version: text("version").notNull().unique(),
  title: text("title").notNull(),
  items: jsonb("items").$type<BuildItem[]>().notNull(),
  publishedAt: timestamp("published_at", { withTimezone: true }),
  createdBy: uuid("created_by").references(() => authUsers.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}).enableRLS();

export const supportReplies = pgTable("support_replies", {
  id: uuid("id").primaryKey(),
  requestId: uuid("request_id").notNull().references(() => supportRequests.id, { onDelete: "cascade" }),
  adminId: uuid("admin_id").references(() => authUsers.id, { onDelete: "set null" }),
  recipient: text("recipient").notNull(),
  subject: text("subject").notNull(),
  body: text("body").notNull(),
  replyTo: text("reply_to").notNull(),
  providerId: text("provider_id"),
  sentAt: timestamp("sent_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, t => [index("support_replies_request_idx").on(t.requestId, t.createdAt)]).enableRLS();
