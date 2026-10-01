import { relations } from "drizzle-orm";
import {
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

import {
  connectionKindEnum,
  connectionProviderEnum,
  connectionStatusEnum,
  syncJobStatusEnum,
} from "./enums";
import { organizations } from "./office";

/**
 * CONNECTIONS — what this product is allowed to read and write somewhere else.
 *
 * An Office attribute rather than an object (Object Model §5.1): a contractor
 * fills each slot at most once, and nobody navigates to a list of connections.
 *
 * **The governing rule is integrate, don't change.** A one-truck shop already
 * gets paid somehow — a bank transfer, a cheque, Zelle, Venmo, cash, or a card
 * through Square — and already keeps books in QuickBooks. Requiring a new
 * merchant account to use the product puts a barrier in front of the exact
 * customer it is for. So every provider below is one they already have or can
 * link without changing how they get paid, and the rails that expose no
 * third-party API arrive as a bank-feed match or a recorded payment instead.
 *
 * **This is not the same Stripe as `billing.ts`.** That one is us charging the
 * contractor for their subscription, on our own account. `stripe_connect` here
 * is the contractor charging a homeowner, on theirs. Two integrations, two sets
 * of credentials, and conflating them is how a subscription webhook ends up
 * writing to a customer's invoice.
 */
export const connections = pgTable(
  "connections",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),

    /** The slot. One filled slot per kind per Office. */
    kind: connectionKindEnum("kind").notNull(),
    /** Who fills it. */
    provider: connectionProviderEnum("provider").notNull(),

    status: connectionStatusEnum("status").notNull().default("connected"),

    /**
     * The provider's own id for the account we are attached to — a QuickBooks
     * `realmId`, a Square merchant id, a Stripe `acct_`, a Plaid `item_id`.
     *
     * Stored because it is what every later call is scoped by, and because it
     * is the only way to tell "reconnected the same company" from "connected a
     * different one", which is a data-corruption question rather than a
     * cosmetic one.
     */
    externalAccountId: text("external_account_id"),
    /** What the contractor will recognise: "Whitfield Electric", "Chase ••4471". */
    externalAccountName: text("external_account_name"),

    /** Exactly what the contractor granted, so the page can state it back. */
    scopes: text("scopes").array(),

    connectedAt: timestamp("connected_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    /** The last time a real call to the provider succeeded. Drives health. */
    lastHealthyAt: timestamp("last_healthy_at", { withTimezone: true }),
    /** Plain language, shown to the contractor. Never a raw provider error. */
    lastError: text("last_error"),
    lastErrorAt: timestamp("last_error_at", { withTimezone: true }),

    /** Provider-specific settings — the QBO account mapping, Plaid cursor. */
    settings: jsonb("settings").$type<Record<string, unknown>>(),

    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("connections_organization_id_idx").on(t.organizationId),
    // One provider per Office. Reconnecting updates the row rather than
    // stacking a second one nobody can tell apart.
    uniqueIndex("connections_org_provider_unique").on(
      t.organizationId,
      t.provider
    ),
  ]
);

/**
 * The tokens, apart from everything else.
 *
 * **A separate table so a secret is never in a row anything else selects.**
 * Every read of `connections` in product code returns health and account name;
 * getting at a token takes a deliberate call to a module that decrypts it. That
 * separation is what stops an access token reaching a Server Component's props
 * by accident.
 *
 * Ciphertext, not plaintext: encrypted with AES-256-GCM under a key that lives
 * in the environment rather than the database, so a database dump is not a set
 * of live credentials for other people's accounting systems.
 */
export const connectionSecrets = pgTable("connection_secrets", {
  connectionId: uuid("connection_id")
    .primaryKey()
    .references(() => connections.id, { onDelete: "cascade" }),

  /** AES-256-GCM, base64, `v1.<iv>.<tag>.<ciphertext>`. */
  accessToken: text("access_token").notNull(),
  refreshToken: text("refresh_token"),

  /**
   * When the access token dies. Refresh happens ahead of this rather than on a
   * 401, because a 401 in the middle of a sync is a failed push to retry.
   */
  accessTokenExpiresAt: timestamp("access_token_expires_at", {
    withTimezone: true,
  }),
  /**
   * When the *refresh* token dies, after which only the contractor can fix it.
   * QuickBooks rotates its refresh token on every use and expires it at 100
   * days, so this is the date the reconnect prompt is scheduled from.
   */
  refreshTokenExpiresAt: timestamp("refresh_token_expires_at", {
    withTimezone: true,
  }),

  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

/**
 * One in-flight OAuth handshake.
 *
 * **The `state` parameter is a CSRF defence and it only works if we remember
 * what we sent.** A callback carrying a state we never minted is an attacker
 * trying to attach their accounting company to somebody else's Office, so the
 * row is the check — and it is consumed on use, because a replayable state is
 * not a defence.
 *
 * `codeVerifier` is here for providers that use PKCE. It is a one-use secret
 * with a lifetime measured in minutes, which is why it can sit in a column
 * rather than needing the encryption the long-lived tokens get.
 */
export const oauthStates = pgTable(
  "oauth_states",
  {
    state: text("state").primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    provider: connectionProviderEnum("provider").notNull(),
    /** Who started it, so the callback cannot be completed by someone else. */
    userId: uuid("user_id").notNull(),
    codeVerifier: text("code_verifier"),
    /** Where to send them when it finishes. Same-origin paths only. */
    returnTo: text("return_to"),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [index("oauth_states_expires_at_idx").on(t.expiresAt)]
);

/**
 * Our record ↔ their record.
 *
 * **A join table rather than a `quickbooks_id` column on every table.** A
 * column per provider per entity is a migration every time a connector is
 * added, and it puts a foreign system's identifier inside our own object's
 * shape. This keeps the object model clean and makes "what have we pushed for
 * this org" a single query.
 *
 * `localId` is deliberately untyped text: it points at a customer, an invoice,
 * a payment or a line item, and a foreign key per target would defeat the
 * purpose of having one table.
 */
export const externalRefs = pgTable(
  "external_refs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    provider: connectionProviderEnum("provider").notNull(),

    /** Our side: "customer", "invoice", "payment", "item". */
    entity: text("entity").notNull(),
    localId: text("local_id").notNull(),

    /** Their side. */
    remoteId: text("remote_id").notNull(),
    /** Their optimistic-concurrency token, where they have one (QBO SyncToken). */
    remoteVersion: text("remote_version"),

    lastPushedAt: timestamp("last_pushed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex("external_refs_local_unique").on(
      t.organizationId,
      t.provider,
      t.entity,
      t.localId
    ),
    index("external_refs_remote_idx").on(
      t.organizationId,
      t.provider,
      t.entity,
      t.remoteId
    ),
  ]
);

/**
 * The outbound queue — one row per thing we owe a provider.
 *
 * **Pushes are queued, never inline.** A contractor sending an invoice must not
 * wait on QuickBooks, and must not fail because QuickBooks is down. The queue
 * is what turns "the sync broke" into "three rows are pending", which is the
 * difference between a support ticket and a status the page can show.
 *
 * **`idempotencyKey` is the thing that stops double-billing.** It is derived
 * from the entity and the version of it we are pushing, so a retry after an
 * ambiguous timeout re-sends the same key rather than creating a second invoice
 * in someone's books. Never delete in the provider; a mistake is corrected with
 * a credit memo, which is an accounting act rather than a cleanup.
 */
export const syncJobs = pgTable(
  "sync_jobs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    provider: connectionProviderEnum("provider").notNull(),

    /** What to do: "push_customer", "push_invoice", "pull_transactions". */
    operation: text("operation").notNull(),
    entity: text("entity").notNull(),
    localId: text("local_id").notNull(),

    idempotencyKey: text("idempotency_key").notNull(),
    payload: jsonb("payload").$type<Record<string, unknown>>(),

    status: syncJobStatusEnum("status").notNull().default("pending"),
    attempts: integer("attempts").notNull().default(0),
    /** Exponential backoff. The drain only picks up rows that are due. */
    nextAttemptAt: timestamp("next_attempt_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    /** Plain language — this reaches the contractor on the sync-health list. */
    lastError: text("last_error"),
    /** Set when a push lands, so the row is its own receipt. */
    remoteId: text("remote_id"),

    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    // The drain's read: what is due, oldest first.
    index("sync_jobs_due_idx").on(t.status, t.nextAttemptAt),
    index("sync_jobs_organization_id_idx").on(t.organizationId, t.status),
    // One live job per thing-and-version. A second enqueue of the same push is
    // the same push, and this is where that stops being a race.
    uniqueIndex("sync_jobs_idempotency_unique").on(
      t.organizationId,
      t.provider,
      t.idempotencyKey
    ),
  ]
);

export const connectionsRelations = relations(connections, ({ one }) => ({
  organization: one(organizations, {
    fields: [connections.organizationId],
    references: [organizations.id],
  }),
  secret: one(connectionSecrets, {
    fields: [connections.id],
    references: [connectionSecrets.connectionId],
  }),
}));

export type Connection = typeof connections.$inferSelect;
export type NewConnection = typeof connections.$inferInsert;
export type ConnectionSecret = typeof connectionSecrets.$inferSelect;
export type ExternalRef = typeof externalRefs.$inferSelect;
export type SyncJob = typeof syncJobs.$inferSelect;
export type NewSyncJob = typeof syncJobs.$inferInsert;
