import { relations } from "drizzle-orm";
import {
  boolean,
  date,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

import { authUsers } from "./auth";
import {
  billingTriggerEnum,
  contractTypeEnum,
  estimateClassEnum,
  estimatingMethodEnum,
  licenseStatusEnum,
  lineItemSectionEnum,
  memberRoleEnum,
  moneyUpFrontEnum,
  presetSourceEnum,
  priceStructureEnum,
  pricingMethodEnum,
  progressBillingEnum,
} from "./enums";

/**
 * THE OFFICE — Object Model §3 and §5.1.
 *
 * The business itself: its identity, its paperwork, its house rules, and the
 * connections to everything outside the product. Changed rarely and
 * deliberately, and it answers *"how is my business set up?"* Its objects
 * **supply data to** a Job's documents and are never edited from one: a Preset
 * supplies the five decisions to a Quote, an Assembly builds scope inside one,
 * a License stamps a document and authorizes a Permit, a Trade pack supplies
 * templates and taxonomy.
 *
 * That one-directional rule is what keeps the Office from becoming a junk
 * drawer and the Job hub from becoming a settings screen.
 *
 * **Shop is deliberately not the word here.** A shop is a physical place with
 * an inventory and a service area, and a contractor who grows runs several — so
 * the term is held for the object it will name at team tier (Object Model
 * §4.3). Lowercase *shop* still means what it means in the trade in ordinary
 * prose; as a model term, the Office is the word.
 */

/**
 * The account, and the Office's own identity — Object Model §5.1.
 *
 * These are the attributes every outbound document draws on, which is why they
 * sit on the account rather than in a settings blob: a document header cites a
 * defined source instead of an undefined profile field.
 *
 * The Office is **not an object** — one instance, no lifecycle, nothing to
 * navigate to. It names a place in the model and a destination in the
 * interface, and these columns are the bag of attributes hanging off it.
 */
export const organizations = pgTable(
  "organizations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    name: text("name").notNull(),
    slug: text("slug").notNull().unique(),
    /** Goes at the top of every document the customer reads. */
    phone: text("phone"),
    email: text("email"),
    address: text("address"),
    website: text("website"),
    logoUrl: text("logo_url"),
    /**
     * What the business does — electrical, plumbing and so on. Asked once, as
     * one tap, and read wherever the product is trade-specific. Null until
     * answered; skipping the question is a real answer too.
     */
    trade: text("trade"),
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
  (t) => [index("organizations_created_by_idx").on(t.createdBy)]
);

/**
 * Application-level mirror of `auth.users`. Supabase owns its own table, so
 * profile data lives here and is created by the `handle_new_user` trigger.
 */
export const profiles = pgTable("profiles", {
  id: uuid("id")
    .primaryKey()
    .references(() => authUsers.id, { onDelete: "cascade" }),
  email: text("email").notNull(),
  fullName: text("full_name"),
  avatarUrl: text("avatar_url"),
  phone: text("phone"),
  /**
   * The trade, answered before the Office existed. Activation asks it ahead of
   * the first quote and the Office is created later, at the letterhead — so
   * the answer waits here and is copied onto the Office when it arrives.
   */
  trade: text("trade"),
  /** When the one-time "this is a job now" beat was shown. Once, ever. */
  teachSeenAt: timestamp("teach_seen_at", { withTimezone: true }),
  /** When the post-send offers were dismissed. They do not come back. */
  offersDismissedAt: timestamp("offers_dismissed_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const memberships = pgTable(
  "memberships",
  {
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => authUsers.id, { onDelete: "cascade" }),
    role: memberRoleEnum("role").notNull().default("technician"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.organizationId, t.userId] }),
    index("memberships_user_id_idx").on(t.userId),
  ]
);

/**
 * The person the work is for.
 *
 * Deliberately thin — a directory that finds jobs by person is the launch
 * scope. Job count, open balance and last-job date are **derived** from the job
 * tree rather than stored here, so they cannot drift.
 *
 * Address is one field, not a normalised set: there is no Property object in
 * the model. A Job carries its own address, because the same customer's second
 * job may be at a different one.
 */
export const customers = pgTable(
  "customers",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    email: text("email"),
    phone: text("phone"),
    address: text("address"),
    notes: text("notes"),
    /**
     * Made on the demo start. Kept and labelled in the directory, and never
     * matched by name when a real quote is written — real work must never be
     * hung off a practice customer.
     */
    isDemo: boolean("is_demo").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [index("customers_organization_id_idx").on(t.organizationId)]
);

/**
 * A credential the Office holds — differentiator #6.
 *
 * Jurisdiction is the field a License and a Permit are matched on. Where a
 * trade licenses per municipality rather than per state, a missing local
 * license is not a cosmetic problem on a document: it is a job that cannot
 * legally start.
 */
export const licenses = pgTable(
  "licenses",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    /**
     * What the shop calls it — "Master electrician", "Philadelphia". Only for
     * telling licenses apart in the Office; nothing a customer reads prints
     * it, because the number is what they check.
     */
    name: text("name"),
    jurisdiction: text("jurisdiction").notNull(),
    number: text("number").notNull(),
    class: text("class"),
    holder: text("holder"),
    issuedOn: date("issued_on"),
    expiresOn: date("expires_on"),
    /** Days before expiry to start reminding. */
    renewalReminderDays: integer("renewal_reminder_days").default(60),
    status: licenseStatusEnum("status").notNull().default("active"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("licenses_organization_id_idx").on(t.organizationId),
    index("licenses_jurisdiction_idx").on(t.organizationId, t.jurisdiction),
  ]
);

/**
 * A named set of values across all five pricing decisions — the unit a
 * contractor thinks in when they say "that's a service call".
 *
 * A pack *ships* presets; the Office *authors* its own, and those exist with
 * no pack behind them. Over a few months the preset list becomes a description
 * of how that business actually works, which is why a contractor names them
 * rather than the app hiding them as configuration.
 *
 * **Preset and Assembly are both authored here and answer different
 * questions.** A Preset configures a document — the five decisions it carries.
 * An Assembly builds scope inside one.
 */
export const presets = pgTable(
  "presets",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    source: presetSourceEnum("source").notNull().default("shop"),
    /** Set when the preset shipped with a pack. */
    packId: text("pack_id"),

    // The five decisions.
    estimatingMethod: estimatingMethodEnum("estimating_method"),
    estimateClass: estimateClassEnum("estimate_class"),
    pricingMethod: pricingMethodEnum("pricing_method"),
    priceStructure: priceStructureEnum("price_structure"),
    contractType: contractTypeEnum("contract_type"),
    billingTrigger: billingTriggerEnum("billing_trigger"),
    moneyUpFront: moneyUpFrontEnum("money_up_front"),
    depositPercent: integer("deposit_percent"),
    progressBilling: progressBillingEnum("progress_billing"),
    retainagePercent: integer("retainage_percent"),

    /** Lines the preset seeds a new quote with. */
    defaultLineItems: jsonb("default_line_items").$type<unknown[]>(),
    timesUsed: integer("times_used").notNull().default(0),

    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [index("presets_organization_id_idx").on(t.organizationId)]
);

/**
 * A named bundle of line items and labor placed as one unit — *install a
 * recessed can*, *rough in a bedroom* — and the block a contractor builds scope
 * out of. Object Model §5.1.
 *
 * **The library entry and the placed row are different records.** Placing an
 * Assembly creates a Line item of type `assembly` with children on the Quote;
 * this table is what it was copied *from*. Editing the library never reaches
 * back into a sent Quote, which is what keeps a document a record of what was
 * offered rather than a live view of today's prices.
 *
 * It belongs to the Office because it outlives every job, exactly like
 * `presets` — and it is the reason `line_item_type` has an `assembly` value
 * with nowhere to come from until now.
 */
export const assemblies = pgTable(
  "assemblies",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    source: presetSourceEnum("source").notNull().default("shop"),
    /** Set when the assembly shipped with a pack. */
    packId: text("pack_id"),
    /** What one of these is — "each", "circuit", "room". */
    unit: text("unit"),
    timesUsed: integer("times_used").notNull().default(0),

    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [index("assemblies_organization_id_idx").on(t.organizationId)]
);

/**
 * What an Assembly is made of — its parts and its labor.
 *
 * Deliberately **not** rows in `line_items`. A line item belongs to a document
 * and carries a document's money; these are a template's components, and giving
 * them a nullable `quote_id` would put library rows in the same table the
 * editor reads, one missing filter away from appearing on somebody's quote.
 *
 * The columns mirror the priced-leaf half of a line item — description,
 * quantity, unit, unit cost, markup, cost bucket — because that is exactly what
 * a component expands into when the assembly is placed.
 */
export const assemblyComponents = pgTable(
  "assembly_components",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    assemblyId: uuid("assembly_id")
      .notNull()
      .references(() => assemblies.id, { onDelete: "cascade" }),

    description: text("description").notNull(),
    /** Which cost bucket this component lands in when it is placed. */
    section: lineItemSectionEnum("section").notNull(),
    quantity: numeric("quantity", { precision: 12, scale: 3 })
      .notNull()
      .default("1"),
    unit: text("unit"),
    unitCostCents: integer("unit_cost_cents"),
    markupPercent: numeric("markup_percent", { precision: 7, scale: 3 }),

    position: integer("position").notNull().default(0),
  },
  (t) => [index("assembly_components_assembly_id_idx").on(t.assemblyId)]
);

/**
 * Trade packs — **two tables, one object**, because entitlement and enablement
 * are separate states. Owning a pack and running a pack are different things,
 * and a contractor who works two trades needs to switch one off without losing
 * it or re-buying it.
 */
export const packEntitlements = pgTable(
  "pack_entitlements",
  {
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    /** Pack slug — `electrical`, `plumbing`. Packs are content, not rows. */
    packId: text("pack_id").notNull(),
    /** The Stripe subscription item that pays for it. */
    stripeSubscriptionItemId: text("stripe_subscription_item_id"),
    grantedAt: timestamp("granted_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
  },
  (t) => [primaryKey({ columns: [t.organizationId, t.packId] })]
);

export const packEnablement = pgTable(
  "pack_enablement",
  {
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    packId: text("pack_id").notNull(),
    enabled: boolean("enabled").notNull().default(true),
    /** Office tuning that must survive a pack version update. */
    configuration: jsonb("configuration").$type<Record<string, unknown>>(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.organizationId, t.packId] }),
    uniqueIndex("pack_enablement_org_pack_idx").on(t.organizationId, t.packId),
  ]
);

export const organizationsRelations = relations(organizations, ({ many }) => ({
  memberships: many(memberships),
  customers: many(customers),
  licenses: many(licenses),
  presets: many(presets),
  assemblies: many(assemblies),
}));

export const membershipsRelations = relations(memberships, ({ one }) => ({
  organization: one(organizations, {
    fields: [memberships.organizationId],
    references: [organizations.id],
  }),
  profile: one(profiles, {
    fields: [memberships.userId],
    references: [profiles.id],
  }),
}));

export const customersRelations = relations(customers, ({ one }) => ({
  organization: one(organizations, {
    fields: [customers.organizationId],
    references: [organizations.id],
  }),
}));

export type Organization = typeof organizations.$inferSelect;
export type Profile = typeof profiles.$inferSelect;
export type Membership = typeof memberships.$inferSelect;
export type Customer = typeof customers.$inferSelect;
export type License = typeof licenses.$inferSelect;
export type Preset = typeof presets.$inferSelect;

/**
 * The Office's document and money defaults — screen 41, job CF1.
 *
 * **A default is a starting value, and that is the whole contract with the
 * contractor.** Changing one applies to the next quote; anything already
 * created, and anything already sent, stays exactly as it is. That is the first
 * question asked before touching any of these, and it is why nothing here is
 * ever read by a document that already exists — a Quote copies these at
 * creation and owns its copy from then on.
 *
 * **One row per organization**, keyed by it rather than carrying an id of its
 * own: there is no second set of defaults, and a table that permits one would
 * eventually grow a way to pick between them.
 *
 * Separate from `presets` on purpose. A Preset is a named set of *the five
 * decisions* — "that's a service call" — and the Office holds several. This is
 * the numbers and the wording underneath all of them, and there is exactly one.
 */
export const officeDefaults = pgTable("office_defaults", {
  organizationId: uuid("organization_id")
    .primaryKey()
    .references(() => organizations.id, { onDelete: "cascade" }),

  // Money. Null means "we have no opinion" rather than zero — a business that
  // has not set a tax rate is not one with a 0% tax rate, and the editor has to
  // be able to tell those apart to know whether to ask.
  depositPercent: integer("deposit_percent"),
  materialMarkupPercent: numeric("material_markup_percent", {
    precision: 7,
    scale: 3,
  }),
  laborRateCents: integer("labor_rate_cents"),
  /** Decimal fraction, e.g. 0.0825 — the same shape the Quote stores. */
  taxRate: numeric("tax_rate", { precision: 6, scale: 4 }),
  /** What makes a Quote an offer that expires rather than one held open. */
  quoteValidityDays: integer("quote_validity_days").default(30),

  /**
   * How a job billed in stages is usually split — Object Model §5.1's *draw
   * pattern*, and the shape `draw_schedule` rows are seeded from.
   *
   * A pattern, not a schedule: named stages and their percentages, with no job
   * behind them and no amounts. The Job's own `draw_schedule` is where a
   * pattern lands once there is a price to apply it to, and editing this never
   * reaches a schedule that already exists.
   */
  drawPattern: jsonb("draw_pattern").$type<
    Array<{ name: string; percent: number }>
  >(),

  /**
   * Scope language, one line each.
   *
   * These seed **Scope nodes** on a new quote — an `exclusion` and an
   * `assumption` row per line — rather than being fields on the document. The
   * rule is that job-specific text lives in Scope and reusable text lives in
   * Terms; this is the reusable text that *starts* the job-specific text, and
   * the contractor edits or deletes the rows like any other.
   */
  standardExclusions: text("standard_exclusions"),
  standardAssumptions: text("standard_assumptions"),

  /**
   * The contractor's stored signature — Documents §5 and §6.
   *
   * Applied automatically when a Contract is generated from an accepted Quote,
   * so the homeowner is never the first to sign a document nobody has committed
   * to. `autoSignContracts` is the deferral: some contractors do not want their
   * business bound without a per-document action, and that is a legitimate way
   * to run a shop rather than a setting to talk them out of.
   *
   * With no stored signature there is nothing to apply, and the Contract is
   * generated unsigned by both parties — a real state, not a failure.
   */
  signatureName: text("signature_name"),
  /** The drawn image as a data URL, or `typed:<name>`. */
  signatureMark: text("signature_mark"),
  autoSignContracts: boolean("auto_sign_contracts").notNull().default(true),

  /**
   * The reusable half of a document's Terms — Object Model §5.1.
   *
   * The other half is **derived from the five decisions** and restated live in
   * the editor's commitment summary, so it is never stored here. This is what
   * the business says on every document regardless of how a given job was
   * priced: warranty, payment window, dispute handling.
   *
   * The split is the same one that puts exclusions in Scope: job-specific text
   * lives on the document, reusable text lives in the Office.
   */
  standardTerms: text("standard_terms"),

  /**
   * **Document branding** — screen 42, and the reason `/office/branding` and
   * `/settings/appearance` are two destinations. This is how the *business*
   * looks to a homeowner; Appearance is how the *app* looks to the contractor,
   * and that one is a per-person preference with nothing to store here.
   *
   * A preset, not a design tool: the contractor picks which of a few good ones
   * their business looks like, and it applies to the PDF and the share surface
   * so the two never drift.
   */
  documentPreset: text("document_preset").default("plain"),

  /** The Preset a new quote starts from, when the Office has named one. */
  defaultPresetId: uuid("default_preset_id").references(() => presets.id, {
    onDelete: "set null",
  }),

  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const officeDefaultsRelations = relations(officeDefaults, ({ one }) => ({
  organization: one(organizations, {
    fields: [officeDefaults.organizationId],
    references: [organizations.id],
  }),
  defaultPreset: one(presets, {
    fields: [officeDefaults.defaultPresetId],
    references: [presets.id],
  }),
}));

export const assembliesRelations = relations(assemblies, ({ one, many }) => ({
  organization: one(organizations, {
    fields: [assemblies.organizationId],
    references: [organizations.id],
  }),
  components: many(assemblyComponents),
}));

export const assemblyComponentsRelations = relations(
  assemblyComponents,
  ({ one }) => ({
    assembly: one(assemblies, {
      fields: [assemblyComponents.assemblyId],
      references: [assemblies.id],
    }),
  })
);

export type OfficeDefaults = typeof officeDefaults.$inferSelect;
export type Assembly = typeof assemblies.$inferSelect;
export type AssemblyComponent = typeof assemblyComponents.$inferSelect;
