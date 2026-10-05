import { sql } from "drizzle-orm";
import {
  bigint,
  bigserial,
  boolean,
  check,
  date,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";

import { authUsers } from "./auth";

/**
 * THE ADMIN DASHBOARD — for the people who build ServiceClerk, not the people
 * who use it.
 *
 * Written by database triggers (drizzle/0032_admin_observability.sql), read
 * live over Supabase Realtime, and visible only to platform admins by RLS.
 */

/**
 * Who may open /admin. The owners named in `ADMIN_EMAILS` are always here
 * (added when they open the panel, never removable from it); an owner can add
 * anyone else from Accounts. RLS — and so the live feed — checks this table.
 */
export const platformAdmins = pgTable("platform_admins", {
  userId: uuid("user_id")
    .primaryKey()
    .references(() => authUsers.id, { onDelete: "cascade" }),
  email: text("email").notNull(),
  addedAt: timestamp("added_at", { withTimezone: true }).notNull().defaultNow(),
  grantedBy: uuid("granted_by"),
  note: text("note"),
});

/**
 * How one account is treated, when it isn't ordinary. No row, ordinary.
 *
 * - `kind: "tester"` — an account given to someone to try the product.
 *   `accessUntil` ends it (the hourly sweep suspends it that day) and
 *   `dailySendLimit` caps how many documents it can send a day.
 * - `compPlan` — treated as paying, charged nothing.
 * - `internal` — the team's own account; never counted on the dashboard.
 * - `bannedAt` — suspended. Supabase Auth's ban is what stops them signing in;
 *   this is the record of why and by whom.
 */
export const accountPolicies = pgTable(
  "account_policies",
  {
    userId: uuid("user_id")
      .primaryKey()
      .references(() => authUsers.id, { onDelete: "cascade" }),
    kind: text("kind").$type<"standard" | "tester">().notNull().default("standard"),
    compPlan: boolean("comp_plan").notNull().default(false),
    /**
     * One of ours — the team's own account. Its shops, payments and activity
     * never count on the admin dashboard; they still show in the feed, marked
     * internal. See `admin_is_internal_org` (drizzle/0048).
     */
    internal: boolean("internal").notNull().default(false),
    accessUntil: date("access_until"),
    dailySendLimit: integer("daily_send_limit"),
    note: text("note"),
    bannedAt: timestamp("banned_at", { withTimezone: true }),
    bannedReason: text("banned_reason"),
    bannedBy: uuid("banned_by"),
    createdBy: uuid("created_by"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("account_policies_kind_idx").on(t.kind),
    check("account_policies_kind_check", sql`${t.kind} in ('standard', 'tester')`),
    check(
      "account_policies_limit_check",
      sql`${t.dailySendLimit} is null or ${t.dailySendLimit} >= 0`
    ),
  ]
);

export type AccountPolicy = typeof accountPolicies.$inferSelect;

export type AdminEventLevel = "money" | "milestone" | "activity" | "problem";

/** One thing that happened, anywhere, in words. Append-only. */
export const adminEvents = pgTable(
  "admin_events",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull().defaultNow(),
    kind: text("kind").notNull(),
    level: text("level").$type<AdminEventLevel>().notNull(),
    organizationId: uuid("organization_id"),
    orgName: text("org_name"),
    userId: uuid("user_id"),
    title: text("title").notNull(),
    amountCents: bigint("amount_cents", { mode: "number" }),
    /** From a shop one of the check scripts made. */
    test: boolean("test").notNull().default(false),
    /** About demo work — practice, not real business. */
    demo: boolean("demo").notNull().default(false),
    /** From the team's own accounts — real use, not real business. */
    internal: boolean("internal").notNull().default(false),
    data: jsonb("data").$type<Record<string, unknown>>().notNull().default({}),
  },
  (t) => [
    index("admin_events_occurred_idx").on(t.occurredAt.desc()),
    index("admin_events_kind_idx").on(t.kind, t.occurredAt.desc()),
  ]
);

/** Who has the app open, by area — touched about once a minute. */
export const userPresence = pgTable(
  "user_presence",
  {
    userId: uuid("user_id")
      .primaryKey()
      .references(() => authUsers.id, { onDelete: "cascade" }),
    organizationId: uuid("organization_id"),
    area: text("area").notNull(),
    device: text("device"),
    lastSeen: timestamp("last_seen", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("user_presence_last_seen_idx").on(t.lastSeen.desc())]
);

/**
 * Who used the app in which hour — the history `user_presence` doesn't keep.
 *
 * One row per person per clock hour they had it open, written by the presence
 * beacon (`insert … on conflict do nothing`, so the minute-by-minute pings
 * cost one row an hour). Hours rather than days so daily, weekly and monthly
 * active users can be cut on the viewer's own clock, and so the dashboard can
 * say when in the day contractors work. Read only by the admin dashboard.
 */
export const userActivityHours = pgTable(
  "user_activity_hours",
  {
    userId: uuid("user_id")
      .notNull()
      .references(() => authUsers.id, { onDelete: "cascade" }),
    hour: timestamp("hour", { withTimezone: true }).notNull(),
    organizationId: uuid("organization_id"),
  },
  (t) => [
    primaryKey({ columns: [t.userId, t.hour] }),
    index("user_activity_hours_hour_idx").on(t.hour),
  ]
);

export type AdminEvent = typeof adminEvents.$inferSelect;
