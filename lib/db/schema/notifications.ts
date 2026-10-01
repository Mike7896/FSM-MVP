import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  index,
  integer,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

import { authUsers } from "./auth";
import { organizations } from "./office";

/**
 * NOTIFICATIONS — what reaches a person about their business, and whether it
 * got there. Content Design §7.6 · IA §3.4 · screen 44.
 *
 * **The dashboard is the inbox; these relay into it.** Every row names a state
 * and links to the screen that changes it. Nothing here is a second place to
 * read the business from — the channels exist to bring someone who isn't
 * looking at the dashboard back to the screen that needs them.
 *
 * Three tables, because they change for three reasons: what happened is
 * written once, how it was delivered is retried, and what a person wants to
 * hear about is theirs to change.
 */

/**
 * One thing that happened, addressed to one person.
 *
 * **The words are stored, not re-derived at send time.** A retry an hour later
 * sends the sentence the event produced, not one recomposed from a quote that
 * has moved on since.
 *
 * `dedupe_key` is what makes emitting safe to repeat. Stripe redelivers
 * webhooks and the sweeps look again every few minutes; the unique index turns
 * the second emit into nothing rather than a second email.
 */
export const notifications = pgTable(
  "notifications",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => authUsers.id, { onDelete: "cascade" }),
    /**
     * An event from `lib/notifications/catalog.ts`. Text rather than an enum,
     * so a new event needs no migration.
     */
    kind: text("kind").notNull(),
    title: text("title").notNull(),
    body: text("body").notNull(),
    /** The route that changes the state the title names. */
    href: text("href").notNull(),
    dedupeKey: text("dedupe_key").notNull(),
    /** Seen in the app — opened from the bell, or marked read. */
    readAt: timestamp("read_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex("notifications_user_dedupe_key").on(t.userId, t.dedupeKey),
    // The sweeps ask "has this Office been told?" before composing anything.
    index("notifications_organization_dedupe_idx").on(
      t.organizationId,
      t.dedupeKey
    ),
    // The bell: one person's newest, in one Office.
    index("notifications_user_feed_idx").on(
      t.userId,
      t.organizationId,
      t.createdAt
    ),
  ]
);

export type DeliveryChannel = "email" | "push" | "sms";

/**
 * `pending` → `sending` → `sent`, or `failed` and retried until `dead`.
 *
 * `skipped` means there was nothing to send it with — no email provider on this
 * server — and it is deliberately never retried: the day a key is added, a
 * backlog of stale news must not go out all at once.
 */
export type DeliveryStatus =
  | "pending"
  | "sending"
  | "sent"
  | "failed"
  | "dead"
  | "skipped";

/**
 * One notification on one channel — a queue row, the same shape as `sync_jobs`
 * and for the same reasons: claimed with `skip locked`, retried with backoff,
 * and given up on with the reason written down.
 */
export const notificationDeliveries = pgTable(
  "notification_deliveries",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    notificationId: uuid("notification_id")
      .notNull()
      .references(() => notifications.id, { onDelete: "cascade" }),
    channel: text("channel").$type<DeliveryChannel>().notNull(),
    status: text("status").$type<DeliveryStatus>().notNull().default("pending"),
    attempts: integer("attempts").notNull().default(0),
    nextAttemptAt: timestamp("next_attempt_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    /** When a sender took it. A claim this old is a sender that died mid-send. */
    claimedAt: timestamp("claimed_at", { withTimezone: true }),
    /** The address it went to — read at send time, kept for the record. */
    recipient: text("recipient"),
    providerMessageId: text("provider_message_id"),
    lastError: text("last_error"),
    /**
     * Held for the daily summary. The summary sends every held email for one
     * person together at their chosen hour; nothing else touches these.
     */
    digest: boolean("digest").notNull().default(false),
    sentAt: timestamp("sent_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex("notification_deliveries_channel_key").on(
      t.notificationId,
      t.channel
    ),
    index("notification_deliveries_due_idx").on(t.status, t.nextAttemptAt),
    check(
      "notification_deliveries_channel",
      sql`${t.channel} in ('email', 'push', 'sms')`
    ),
    check(
      "notification_deliveries_status",
      sql`${t.status} in ('pending', 'sending', 'sent', 'failed', 'dead', 'skipped')`
    ),
  ]
);

/**
 * What one person wants to hear about, per event and channel — screen 44.
 *
 * **A row exists only where somebody changed something.** Everything else reads
 * the catalog's default, so a better default reaches everyone who never touched
 * the screen — which, if the defaults are right, is nearly everyone.
 *
 * Per person, not per Office: Settings is the app for whoever is signed in, and
 * one admin muting quote opens mutes them for nobody else.
 */
export const notificationPreferences = pgTable(
  "notification_preferences",
  {
    userId: uuid("user_id")
      .notNull()
      .references(() => authUsers.id, { onDelete: "cascade" }),
    kind: text("kind").notNull(),
    push: boolean("push").notNull(),
    email: boolean("email").notNull(),
    /** Null until they choose — the catalog's default until then. */
    sms: boolean("sms"),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.kind] })]
);

/**
 * How one person is reached, across every event — the other half of screen 44.
 *
 * The preferences say *which* events reach them on *which* channel; this says
 * where texts go, how often email comes, which hours texts wait through, and
 * whether the app pops things up while they work. No row means nobody has
 * saved the screen: email as it happens, no texts, no quiet hours, pop-ups on.
 *
 * `time_zone` is the browser's, taken when the screen is saved — quiet hours
 * and the summary hour mean nothing without one, and asking for it is a
 * question the browser already knows the answer to.
 */
export const notificationSettings = pgTable(
  "notification_settings",
  {
    userId: uuid("user_id")
      .primaryKey()
      .references(() => authUsers.id, { onDelete: "cascade" }),
    emailFrequency: text("email_frequency")
      .$type<"instant" | "daily">()
      .notNull()
      .default("instant"),
    /** The hour the daily summary goes, 0–23, in `time_zone`. */
    digestHour: integer("digest_hour").notNull().default(8),
    /** Where texts go, E.164 — `+15551234567`. */
    smsPhone: text("sms_phone"),
    quietHours: boolean("quiet_hours").notNull().default(false),
    quietStart: integer("quiet_start").notNull().default(21),
    quietEnd: integer("quiet_end").notNull().default(7),
    timeZone: text("time_zone"),
    toasts: boolean("toasts").notNull().default(true),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    check(
      "notification_settings_email_frequency",
      sql`${t.emailFrequency} in ('instant', 'daily')`
    ),
    check(
      "notification_settings_hours",
      sql`${t.digestHour} between 0 and 23 and ${t.quietStart} between 0 and 23 and ${t.quietEnd} between 0 and 23`
    ),
  ]
);

export type NotificationRow = typeof notifications.$inferSelect;
export type NotificationSettingsRow = typeof notificationSettings.$inferSelect;
export type NotificationDelivery = typeof notificationDeliveries.$inferSelect;
