import { relations } from "drizzle-orm";
import {
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";

import { organizations } from "./office";
import { pricingIntervalEnum, subscriptionStatusEnum } from "./enums";

/**
 * Billing tables are a read-model of Stripe: Stripe is the source of truth and
 * the webhook handler projects changes into these rows. Nothing here should be
 * written from product code except `stripe_customers`.
 */

/** Maps an organization to its Stripe Customer. One-to-one. */
export const stripeCustomers = pgTable(
  "stripe_customers",
  {
    organizationId: uuid("organization_id")
      .primaryKey()
      .references(() => organizations.id, { onDelete: "cascade" }),
    stripeCustomerId: text("stripe_customer_id").notNull().unique(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [index("stripe_customers_customer_id_idx").on(t.stripeCustomerId)]
);

/** Mirror of Stripe Products - what we sell. */
export const products = pgTable("products", {
  id: text("id").primaryKey(), // Stripe product id, e.g. prod_123
  active: boolean("active").notNull().default(true),
  name: text("name").notNull(),
  description: text("description"),
  image: text("image"),
  metadata: jsonb("metadata").$type<Record<string, string>>(),
});

/** Mirror of Stripe Prices. */
export const prices = pgTable(
  "prices",
  {
    id: text("id").primaryKey(), // Stripe price id, e.g. price_123
    productId: text("product_id").references(() => products.id, {
      onDelete: "cascade",
    }),
    active: boolean("active").notNull().default(true),
    currency: text("currency").notNull(),
    unitAmount: integer("unit_amount"),
    interval: pricingIntervalEnum("interval"),
    intervalCount: integer("interval_count"),
    trialPeriodDays: integer("trial_period_days"),
    metadata: jsonb("metadata").$type<Record<string, string>>(),
  },
  (t) => [index("prices_product_id_idx").on(t.productId)]
);

export const subscriptions = pgTable(
  "subscriptions",
  {
    id: text("id").primaryKey(), // Stripe subscription id, e.g. sub_123
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    status: subscriptionStatusEnum("status").notNull(),
    priceId: text("price_id").references(() => prices.id),
    quantity: integer("quantity"),

    cancelAtPeriodEnd: boolean("cancel_at_period_end").notNull().default(false),
    // Period bounds live on the subscription *item* in current Stripe API
    // versions; the webhook handler reads them from there.
    currentPeriodStart: timestamp("current_period_start", {
      withTimezone: true,
    }),
    currentPeriodEnd: timestamp("current_period_end", { withTimezone: true }),
    cancelAt: timestamp("cancel_at", { withTimezone: true }),
    canceledAt: timestamp("canceled_at", { withTimezone: true }),
    endedAt: timestamp("ended_at", { withTimezone: true }),
    trialStart: timestamp("trial_start", { withTimezone: true }),
    trialEnd: timestamp("trial_end", { withTimezone: true }),

    metadata: jsonb("metadata").$type<Record<string, string>>(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("subscriptions_organization_id_idx").on(t.organizationId),
    index("subscriptions_status_idx").on(t.status),
  ]
);

/**
 * Idempotency ledger. Stripe retries and can deliver out of order or more than
 * once; the handler inserts here first and bails if the row already exists.
 */
export const stripeEvents = pgTable("stripe_events", {
  id: text("id").primaryKey(), // Stripe event id, e.g. evt_123
  type: text("type").notNull(),
  processedAt: timestamp("processed_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const stripeCustomersRelations = relations(
  stripeCustomers,
  ({ one }) => ({
    organization: one(organizations, {
      fields: [stripeCustomers.organizationId],
      references: [organizations.id],
    }),
  })
);

export const productsRelations = relations(products, ({ many }) => ({
  prices: many(prices),
}));

export const pricesRelations = relations(prices, ({ one }) => ({
  product: one(products, {
    fields: [prices.productId],
    references: [products.id],
  }),
}));

export const subscriptionsRelations = relations(subscriptions, ({ one }) => ({
  organization: one(organizations, {
    fields: [subscriptions.organizationId],
    references: [organizations.id],
  }),
  price: one(prices, {
    fields: [subscriptions.priceId],
    references: [prices.id],
  }),
}));

export type Product = typeof products.$inferSelect;
export type Price = typeof prices.$inferSelect;
export type Subscription = typeof subscriptions.$inferSelect;
