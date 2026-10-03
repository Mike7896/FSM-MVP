import { relations } from "drizzle-orm";
import {
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";

import type {
  SettingDef,
  SettingValues,
  TemplateNode,
} from "@/lib/library/types";

import { authUsers } from "./auth";
import { presetSourceEnum } from "./enums";
import { jobs } from "./jobs";
import { organizations } from "./office";

/**
 * The Library — rows, groups and assemblies the Office has saved, and the
 * settings that size them (UX: Saved Items and Job Settings).
 *
 * A saved item is the Office's, like a preset: it outlives every job. Placing
 * one copies its rows into a quote as ordinary rows, so editing or deleting it
 * never reaches a quote it was already dropped into.
 *
 * The template, settings and defaults are JSON because they are read and
 * written whole — nothing queries inside them — and their shape is checked by
 * `savedItemIssues` on every write.
 */
export const savedItems = pgTable(
  "saved_items",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),

    name: text("name").notNull(),
    /** The saved row and everything inside it. */
    template: jsonb("template").$type<TemplateNode>().notNull(),
    /** What the item is sized by. Empty for a plain saved row. */
    settings: jsonb("settings").$type<SettingDef[]>().notNull().default([]),
    /** The Office's values for those settings, used wherever a job hasn't set its own. */
    defaults: jsonb("defaults").$type<SettingValues>().notNull().default({}),
    /** The tile's subheading, with settings in braces. Null: built from the settings. */
    summary: text("summary"),
    imageUrl: text("image_url"),

    source: presetSourceEnum("source").notNull().default("shop"),
    /** Set when the item came with a pack. */
    packId: text("pack_id"),

    timesUsed: integer("times_used").notNull().default(0),
    lastUsedAt: timestamp("last_used_at", { withTimezone: true }),

    createdBy: uuid("created_by").references(() => authUsers.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [index("saved_items_organization_id_idx").on(t.organizationId)]
);

/**
 * A job's own settings for a saved item — this house's standard window.
 *
 * Set once on the job and used by every drop of that item on any of the job's
 * quotes. They never touch the Office's defaults or any other job. A row only
 * exists while the job overrides something; clearing every value deletes it.
 */
export const jobItemSettings = pgTable(
  "job_item_settings",
  {
    jobId: uuid("job_id")
      .notNull()
      .references(() => jobs.id, { onDelete: "cascade" }),
    savedItemId: uuid("saved_item_id")
      .notNull()
      .references(() => savedItems.id, { onDelete: "cascade" }),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    values: jsonb("values").$type<SettingValues>().notNull().default({}),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.jobId, t.savedItemId] }),
    index("job_item_settings_organization_id_idx").on(t.organizationId),
  ]
);

export const savedItemsRelations = relations(savedItems, ({ one, many }) => ({
  organization: one(organizations, {
    fields: [savedItems.organizationId],
    references: [organizations.id],
  }),
  jobSettings: many(jobItemSettings),
}));

export const jobItemSettingsRelations = relations(jobItemSettings, ({ one }) => ({
  job: one(jobs, {
    fields: [jobItemSettings.jobId],
    references: [jobs.id],
  }),
  savedItem: one(savedItems, {
    fields: [jobItemSettings.savedItemId],
    references: [savedItems.id],
  }),
}));

export type SavedItemRow = typeof savedItems.$inferSelect;
export type JobItemSettingsRow = typeof jobItemSettings.$inferSelect;
