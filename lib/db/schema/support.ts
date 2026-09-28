import { sql } from "drizzle-orm";
import {
  check,
  index,
  integer,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";

import { authUsers } from "./auth";
import { organizations } from "./office";

/**
 * SUPPORT — what a contractor sends us: a problem, an idea, or a request for
 * a person's help.
 *
 * **Every one is kept here first.** Sentry's feedback inbox and the support
 * email are where we read them, but either can be unset on a server or down
 * for a minute; this row is the copy that can't be lost, and the one the
 * sender sees in their own list.
 */

/**
 * - `bug` — something's broken. Also goes to Sentry, with the session replay.
 * - `idea` — something they wish it did.
 * - `help` — they want a person.
 */
export const supportKindEnum = pgEnum("support_kind", ["bug", "idea", "help"]);

/** Where it's got to on our side. `open` until somebody answers. */
export const supportStatusEnum = pgEnum("support_status", ["open", "answered", "closed"]);

export const supportRequests = pgTable(
  "support_requests",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    /** "Request 1042" — one sequence for everyone, so it's unique when quoted back. */
    number: integer("number").generatedAlwaysAsIdentity({ startWith: 1001 }),
    organizationId: uuid("organization_id").references(() => organizations.id, {
      onDelete: "set null",
    }),
    userId: uuid("user_id").references(() => authUsers.id, { onDelete: "set null" }),
    kind: supportKindEnum("kind").notNull(),
    subject: text("subject").notNull(),
    body: text("body").notNull(),
    /** Where to write back. Their sign-in address, captured when it was sent. */
    replyTo: text("reply_to").notNull(),
    /** The page they were on — "/quotes/…" — which is half of most bug reports. */
    page: text("page"),
    userAgent: text("user_agent"),
    /** The feedback event in Sentry, when it got there. */
    sentryEventId: text("sentry_event_id"),
    /** When the support inbox was emailed. Empty says to go and look. */
    emailedAt: timestamp("emailed_at", { withTimezone: true }),
    status: supportStatusEnum("status").notNull().default("open"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("support_requests_user_idx").on(t.userId, t.createdAt),
    index("support_requests_status_idx").on(t.status, t.createdAt),
    check("support_requests_subject_check", sql`length(btrim(${t.subject})) between 1 and 140`),
    check("support_requests_body_check", sql`length(btrim(${t.body})) between 1 and 5000`),
  ]
);

export type SupportRequest = typeof supportRequests.$inferSelect;
