import { relations } from "drizzle-orm";
import {
  boolean,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";

import { connectedAccountStatusEnum } from "./enums";
import { organizations } from "./office";

/**
 * THE CONNECTED ACCOUNT — Payment Rails §2, §4, §5.
 *
 * The contractor's own Stripe account, created by us inside our own flow. He
 * visits no external signup page and manages no separate vendor relationship;
 * he taps "set up payments", fills in a Stripe-hosted form, and comes back able
 * to charge.
 *
 * ## Why this is not a `connections` row
 *
 * `connections` models *linking something the contractor already has*, and its
 * whole apparatus — an OAuth handshake, an encrypted refresh token in
 * `connection_secrets`, a token refresh margin — exists to hold a credential we
 * were granted. There is no credential here. We act on this account with our
 * own platform key and a `Stripe-Account` header, so a `connection_secrets` row
 * for it would be an empty box with a lock on it.
 *
 * What this table holds instead is **capability state**, which the other
 * connectors have no equivalent of: whether charges work, whether payouts work,
 * and what Stripe is still waiting for. A connections row is written alongside
 * this one so the Office's processor slot still renders from one query.
 *
 * ## The two settings that are fixed here, and why
 *
 * **`controller.stripe_dashboard.type = 'express'`.** Stripe states this cannot
 * be changed on an existing account — changing it means creating a new
 * `Account` object — and `full` is documented as incompatible with
 * `controller.losses.payments = 'application'`. So an account created with
 * Stripe's default full-dashboard configuration is *permanently* ineligible for
 * platform-held loss liability, and therefore for Stripe Issuing and Stripe
 * Treasury, for the life of that account. Express costs nothing today and keeps
 * both liability configurations reachable.
 *
 * **`controller.losses.payments = 'stripe'`.** Stripe carries unrecoverable
 * connected-account negative balances, holds no reserve against our platform
 * balance, collects KYC, and its risk team manages connected-account risk with
 * Managed Risk available. The alternative — us absorbing those losses — buys
 * pausing payouts, direct balance debits, Issuing and Treasury, and none of
 * those are launch features. Because the dashboard is Express, that door stays
 * open. Both values are recorded on the row rather than assumed, because one of
 * them is immutable and a future migration has to be able to tell which
 * accounts were created under which rules.
 *
 * ## Merchant of record
 *
 * Charges are **direct charges** created on this account, which makes the
 * contractor the merchant of record on every homeowner payment: his business
 * name on the statement, and disputes debited from his balance rather than
 * ours. Our revenue arrives as an application fee that Stripe splits at the
 * moment the money moves. This is also the compliance seam — customer funds
 * never touch a platform-controlled account, and holding them pending our
 * judgment would be money transmission, a state-licensed activity.
 */
export const connectedAccounts = pgTable(
  "connected_accounts",
  {
    /** One per Office. A shop has one place its money lands. */
    organizationId: uuid("organization_id")
      .primaryKey()
      .references(() => organizations.id, { onDelete: "cascade" }),

    /** Stripe's `acct_...`. */
    stripeAccountId: text("stripe_account_id").notNull().unique(),

    /**
     * The flattened answer to "can this shop take a card right now".
     *
     * Derived from Stripe on every `account.updated` rather than set by hand,
     * because it is a projection of their state and a copy we edit is a copy
     * that lies.
     */
    status: connectedAccountStatusEnum("status").notNull().default("onboarding"),

    /**
     * The three booleans the status is derived from, kept because the contractor
     * needs to be told *which* one is missing.
     *
     * Charges and payouts fail independently and mean different things: an
     * account can accept charges while payouts stay blocked pending
     * verification, and a contractor in that state is getting paid — he just
     * cannot move it to his bank yet. Collapsing them to one flag would make
     * the product tell him the wrong thing.
     */
    chargesEnabled: boolean("charges_enabled").notNull().default(false),
    payoutsEnabled: boolean("payouts_enabled").notNull().default(false),
    detailsSubmitted: boolean("details_submitted").notNull().default(false),

    /**
     * Stripe's `requirements.currently_due`, as given.
     *
     * Stored so the Office can say what is outstanding without a round trip on
     * every page render. Never parsed into our own vocabulary — Stripe's
     * requirement names are what their hosted form asks for, and translating
     * them is how a shop gets told to supply something that does not exist.
     */
    requirementsDue: text("requirements_due").array(),
    /** Stripe's `requirements.disabled_reason`, when charges are off. */
    disabledReason: text("disabled_reason"),

    /** What the contractor sees on the homeowner's statement. */
    businessName: text("business_name"),
    defaultCurrency: text("default_currency").notNull().default("usd"),

    /**
     * Our cut of each charge, in basis points.
     *
     * Per-transaction because Stripe takes the amount in the call that creates
     * each charge, which is what lets the rate vary by plan or by shop without
     * a migration. Nullable and defaulted to zero: the application fee is
     * optional, and a platform may monetize through subscription alone.
     */
    applicationFeeBps: integer("application_fee_bps").notNull().default(0),

    /**
     * What the account was created with. Immutable in Stripe's case, so a
     * later migration has to be able to tell the generations apart.
     */
    dashboardType: text("dashboard_type").notNull().default("express"),
    lossesPayments: text("losses_payments").notNull().default("stripe"),

    /** When the hosted form came back complete. Null while still onboarding. */
    onboardedAt: timestamp("onboarded_at", { withTimezone: true }),

    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [index("connected_accounts_stripe_id_idx").on(t.stripeAccountId)]
);

export const connectedAccountsRelations = relations(
  connectedAccounts,
  ({ one }) => ({
    organization: one(organizations, {
      fields: [connectedAccounts.organizationId],
      references: [organizations.id],
    }),
  })
);

export type ConnectedAccount = typeof connectedAccounts.$inferSelect;
export type NewConnectedAccount = typeof connectedAccounts.$inferInsert;
