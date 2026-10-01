import { relations } from "drizzle-orm";
import { index, jsonb, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";

import { documents } from "./document-spine";
import { jobs } from "./jobs";

/**
 * SHARE LINK — Object Model §5.7.
 *
 * An unforgeable token that names one document and grants a bundle of actions
 * on it. **Possession is permission**; there is no identity check (capability
 * URL — W3C TAG).
 *
 * This object is why the homeowner needs no account. One mechanism serves
 * quotes, contracts, change orders and invoices, which is what lets every
 * homeowner moment feel like the same familiar thing.
 *
 * It surfaces as a verb — *send* — never as a management screen. No contractor
 * wants a list of share links, which is why it fails the Purpose half of the
 * SIP test as a user-facing object even though it is a real one.
 *
 * **One target, and it is a real foreign key** — Documents §9. The link points
 * at the document spine, so a deleted document takes its live tokens with it
 * rather than leaving one behind that opens onto nothing.
 */
export const shareLinks = pgTable(
  "share_links",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    /** The opaque token that appears in the URL. */
    token: text("token").notNull().unique(),

    /** Always present — every document belongs to exactly one Job. */
    jobId: uuid("job_id")
      .notNull()
      .references(() => jobs.id, { onDelete: "cascade" }),

    /** The document this link opens. */
    documentId: uuid("document_id")
      .notNull()
      .references(() => documents.id, { onDelete: "cascade" }),

    /** What the holder may do — view, accept, sign, pay. */
    scopes: jsonb("scopes").$type<string[]>().notNull().default([]),

    expiresAt: timestamp("expires_at", { withTimezone: true }),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    lastAccessedAt: timestamp("last_accessed_at", { withTimezone: true }),

    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("share_links_job_id_idx").on(t.jobId),
    index("share_links_document_idx").on(t.documentId),
  ]
);

/**
 * Every time a link is opened — not only the first time.
 *
 * "Opened twice, last at 9:14 PM" is what tells a contractor whether a call is
 * worth making, and a single `viewed_at` can only ever say "opened". One row
 * per open is the smallest record that says how often and when.
 */
export const shareLinkViews = pgTable(
  "share_link_views",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    shareLinkId: uuid("share_link_id")
      .notNull()
      .references(() => shareLinks.id, { onDelete: "cascade" }),
    viewedAt: timestamp("viewed_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("share_link_views_link_idx").on(t.shareLinkId, t.viewedAt),
  ]
);

export const shareLinksRelations = relations(shareLinks, ({ one }) => ({
  job: one(jobs, { fields: [shareLinks.jobId], references: [jobs.id] }),
  document: one(documents, {
    fields: [shareLinks.documentId],
    references: [documents.id],
  }),
}));

export type ShareLink = typeof shareLinks.$inferSelect;
export type ShareLinkView = typeof shareLinkViews.$inferSelect;
