import { relations, sql } from "drizzle-orm";
import {
  bigint,
  boolean,
  check,
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
  type AnyPgColumn,
} from "drizzle-orm/pg-core";

import { STATUSES, type DocumentType } from "@/lib/documents/lifecycle";
import { authUsers } from "./auth";
import {
  billingTriggerEnum,
  contractTypeEnum,
  depositBasisEnum,
  documentStatusEnum,
  documentTypeEnum,
  estimateClassEnum,
  estimatingMethodEnum,
  invoiceTypeEnum,
  lineItemSectionEnum,
  lineItemSourceEnum,
  lineItemTypeEnum,
  moneyUpFrontEnum,
  priceStructureEnum,
  pricingMethodEnum,
  progressBillingEnum,
  scopeReferenceKindEnum,
  signatureAuthMethodEnum,
  signatureKindEnum,
  signaturePartyEnum,
} from "./enums";
import { jobs } from "./jobs";
import { customers, licenses, organizations } from "./office";

/**
 * THE DOCUMENT SPINE — Documents §2.
 *
 * **One `documents` table, per-type side tables, one `Document` interface in
 * code.** A contract is a row here with `type = 'contract'` *plus* a row in
 * `contract_details`; the type column is how the code knows which side table to
 * join.
 *
 * ## Why not four tables
 *
 * An interface layer solves the code-side problem — four tables plus a composed
 * `Document` type gives one thing to write against. What an interface cannot
 * reach is **every table that points at a document.** Share links, Scope nodes,
 * homeowner questions and draw evidence all belong to *a document*, and with
 * four parent tables none of them can carry a real foreign key: they carry an
 * unenforceable `resource_type` + `resource_id` pair, and the dispute-packet
 * timeline becomes a four-way union. This stands on referential integrity, not
 * on storage.
 *
 * ## Why not one table with only a type column
 *
 * The differing fields would sit as nullable columns on every row and nothing
 * would stop a due date landing on a quote.
 *
 * ## The other half of the ledger
 *
 * `ledger_entries` is the truth of what **moved**. This is the truth of what is
 * **owed**, and every number on the Job hub's money card except *collected to
 * date* comes from here. No document write ever touches the ledger, and issuing
 * an invoice creates no ledger row — that is the cash-only decision carried in
 * from the money design, and it is what makes this side load-bearing rather
 * than decorative.
 */

/**
 * The header, frozen at send — Documents §2.
 *
 * Business name, license number, shop address and customer contact are read
 * from the Office, License, Customer and Job **once** and written here. A quote
 * sent in March must still show the March address after the shop moves in June;
 * a live join would silently rewrite history on documents that are legal
 * records and dispute evidence.
 */
export type HeaderSnapshot = {
  businessName?: string;
  businessPhone?: string;
  businessEmail?: string;
  businessAddress?: string;
  logoUrl?: string;
  licenseNumber?: string;
  licenseKind?: string;
  customerName?: string;
  customerEmail?: string;
  customerPhone?: string;
  customerAddress?: string;
  jobAddress?: string;
  jobNumber?: number;
  /**
   * "Made with ServiceClerk" at the foot — decided by the plan the shop was on
   * when the document went out, and kept for good (Billing §2.2, §5.3).
   * Absent on documents issued before plans existed, which carried it.
   */
  promoFooter?: boolean;
  /** When the snapshot was taken, so a reader can tell how old it is. */
  capturedAt?: string;
};

export const documents = pgTable(
  "documents",
  {
    id: uuid("id").primaryKey().defaultRandom(),

    /**
     * Scoped directly rather than through the Job.
     *
     * Today's document tables reach the shop by joining `jobs`, which makes
     * every tenant-scoped query a join and every RLS policy a subquery. A
     * document belongs to a job *and* to a shop; carrying both is one column
     * against a join on every read.
     */
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    jobId: uuid("job_id")
      .notNull()
      .references(() => jobs.id, { onDelete: "cascade" }),
    /** Denormalized from the Job, because a document is addressed to a person. */
    customerId: uuid("customer_id").references(() => customers.id, {
      onDelete: "set null",
    }),

    type: documentTypeEnum("type").notNull(),
    /** Human-facing and per type — `Q-0007`, `INV-0007`. Set by trigger. */
    number: text("number").notNull(),
    status: documentStatusEnum("status").notNull(),

    /**
     * What generated this one.
     *
     * A Contract's source Quote, a revision's declined original. Nullable
     * throughout, because **every document is creatable without its upstream
     * document** (Object Model §5.3) — a contractor legitimately invoices a job
     * that never had a quote. Change order is the single exception and it does
     * not use this column: its parent is NOT NULL on its own side table,
     * because an amendment with nothing to amend is a Quote.
     */
    sourceDocumentId: uuid("source_document_id").references(
      (): AnyPgColumn => documents.id,
      { onDelete: "set null" }
    ),

    title: text("title"),
    /** The opening paragraph. The rest of Scope is the tree in `scope_nodes`. */
    summary: text("summary"),
    termsText: text("terms_text"),

    header: jsonb("header_snapshot")
      .$type<HeaderSnapshot>()
      .notNull()
      .default({}),

    /** The pack this document was written under. Never rewritten later. */
    packId: text("pack_id"),

    issuedAt: timestamp("issued_at", { withTimezone: true }),
    sentAt: timestamp("sent_at", { withTimezone: true }),
    viewedAt: timestamp("viewed_at", { withTimezone: true }),

    /**
     * Non-null means immutable — Documents §7.
     *
     * Set by trigger the moment `status` enters this type's frozen set, so the
     * lifecycle config is the only place the rule is written. Never cleared:
     * there is no unfreeze.
     */
    frozenAt: timestamp("frozen_at", { withTimezone: true }),

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
  (t) => [
    index("documents_job_type_idx").on(t.organizationId, t.jobId, t.type),
    index("documents_status_idx").on(t.organizationId, t.status),
    index("documents_source_idx").on(t.sourceDocumentId),
    uniqueIndex("documents_number_unique").on(
      t.organizationId,
      t.type,
      t.number
    ),

    /**
     * Four closed status sets in one column.
     *
     * Built from `lib/documents/lifecycle.ts` so the constraint and the client
     * cannot disagree about what a quote is allowed to be. The design doc left
     * `status` as bare `text`, which would have let an invoice be `part_signed`.
     */
    check(
      "documents_status_matches_type",
      // `sql.raw`, not an interpolated template. Drizzle binds an interpolated
      // value as a *parameter*, and a CHECK constraint cannot carry one — the
      // generated DDL comes out as `status in ($1, $2, ...)` and the migration
      // fails at apply time. The values are our own enum literals, so raw is
      // safe here in a way it would never be for user input.
      sql.raw(
        (Object.keys(STATUSES) as DocumentType[])
          .map(
            (type) =>
              `("documents"."type" = '${type}' and "documents"."status" in (` +
              STATUSES[type].map((status) => `'${status}'`).join(", ") +
              `))`
          )
          .join(" or ")
      )
    ),
  ]
);

/* ── Per-type details ─────────────────────────────────────────────────── */

/**
 * The Quote's own fields — the five pricing decisions.
 *
 * **Real columns on real enums, not a `billing_terms` blob.** The design doc
 * collapsed most of decision 5 into jsonb; these are closed value sets the
 * Object Model fixes, the quote editor branches on them, and `tax_rate` is
 * arithmetic input rather than terms. A blob would make every one of them
 * unqueryable and unconstrained.
 */
export const quoteDetails = pgTable("quote_details", {
  documentId: uuid("document_id")
    .primaryKey()
    .references(() => documents.id, { onDelete: "cascade" }),

  validUntil: date("valid_until"),

  // Decision 1 — how cost is predicted, and what that justifies claiming.
  estimatingMethod: estimatingMethodEnum("estimating_method"),
  estimateClass: estimateClassEnum("estimate_class"),
  // Decision 2 — cost is the floor, competition the reference, value the ceiling.
  pricingMethod: pricingMethodEnum("pricing_method"),
  // Decision 3 — the shape she sees, independent of how it was computed.
  priceStructure: priceStructureEnum("price_structure"),
  // Decision 4 — who absorbs the difference when reality moves.
  contractType: contractTypeEnum("contract_type"),
  /** Set where the contract type carries a ceiling — T&M with a cap, GMP. */
  capCents: bigint("cap_cents", { mode: "number" }),
  // Decision 5 — a composite, so it lands as several columns.
  billingTrigger: billingTriggerEnum("billing_trigger"),
  moneyUpFront: moneyUpFrontEnum("money_up_front"),
  depositPercent: integer("deposit_percent"),
  progressBilling: progressBillingEnum("progress_billing"),
  retainagePercent: integer("retainage_percent"),

  /**
   * The Office's draw pattern as it stood when this quote was written.
   *
   * Snapshotted rather than read live: **changing a default never alters an
   * existing document**, and the payment schedule on a quote somebody is
   * holding must not move because the shop edited its pattern this morning.
   * Percentages, because there is no agreed price until this is accepted —
   * they become dollars on the job's plan the moment there is one.
   */
  drawPattern: jsonb("draw_pattern").$type<
    Array<{ name: string; percent: number }>
  >(),

  taxRate: numeric("tax_rate", { precision: 6, scale: 4 }),

  /** Contractor register — the mechanism. Generated from the five decisions. */
  commitmentSummary: text("commitment_summary"),

  licenseId: uuid("license_id").references(() => licenses.id, {
    onDelete: "set null",
  }),

  /** Which tier she picked, on a tiered quote. */
  selectedOptionId: uuid("selected_option_id"),

  /**
   * Whether the quote carries signature lines — Quote Document Structure §3.5.
   *
   * On, the paper ends with a line for each party, and the customer accepts by
   * signing hers: approval and signature are one act, and the contract it
   * generates arrives signed by both. Off, the quote ends at its terms, the
   * customer approves with a button, and signs the contract after. On by
   * default, because a quote is an offer and an offer is signed.
   */
  signatureLines: boolean("signature_lines").notNull().default(true),
});

/**
 * The Contract's own fields.
 *
 * The terms decisions are **carried forward from the Quote rather than joined
 * back to it.** Once a quote is accepted the contract is the agreed document,
 * and reading its deposit percentage out of a superseded quote is how an
 * amended term silently changes what someone already signed.
 *
 * There is no `billing_schedule` blob here. The draw schedule is its own table
 * with a real gate and a real foreign key to the invoice each stage became —
 * and it has to be, because a job billed in stages *before* anything is signed
 * is a real state that a column on the contract cannot hold.
 */
export const contractDetails = pgTable("contract_details", {
  documentId: uuid("document_id")
    .primaryKey()
    .references(() => documents.id, { onDelete: "cascade" }),

  contractSumCents: bigint("contract_sum_cents", { mode: "number" })
    .notNull()
    .default(0),

  depositCents: bigint("deposit_cents", { mode: "number" }),
  depositBasis: depositBasisEnum("deposit_basis").notNull().default("none"),

  contractType: contractTypeEnum("contract_type"),
  billingTrigger: billingTriggerEnum("billing_trigger"),
  moneyUpFront: moneyUpFrontEnum("money_up_front"),
  depositPercent: integer("deposit_percent"),
  progressBilling: progressBillingEnum("progress_billing"),
  retainagePercent: integer("retainage_percent"),

  licenseId: uuid("license_id").references(() => licenses.id, {
    onDelete: "set null",
  }),

  /** When the Quote was accepted, which is when this record came into being. */
  acceptedAt: timestamp("accepted_at", { withTimezone: true }),
});

export const changeOrderDetails = pgTable("change_order_details", {
  documentId: uuid("document_id")
    .primaryKey()
    .references(() => documents.id, { onDelete: "cascade" }),

  /**
   * NOT NULL by definition — an amendment needs something to amend.
   *
   * A trigger asserts this points at a document of type `contract`; a foreign
   * key to the spine cannot express that on its own, and a change order
   * amending a quote is a category error the schema should refuse.
   */
  parentContractId: uuid("parent_contract_id")
    .notNull()
    .references(() => documents.id, { onDelete: "cascade" }),

  whatChanged: text("what_changed"),
  /** SIGNED. Negative on a deduct — the same posture as the ledger. */
  deltaCents: bigint("delta_cents", { mode: "number" }).notNull().default(0),
  timeImpactDays: integer("time_impact_days"),
  taxRate: numeric("tax_rate", { precision: 8, scale: 6 }),
  billingMode: text("billing_mode").notNull().default("next_draw"),
  baseAmountCents: bigint("base_amount_cents", { mode: "number" }),

  approvedAt: timestamp("approved_at", { withTimezone: true }),
});

/**
 * The Invoice's own fields — one object, three moments.
 *
 * A deposit is an Invoice issued at signing, a draw is one released against a
 * met gate, a final balance is one at completion. There is no `gate_key`
 * string: which stage a draw released against is `draw_schedule.invoice_id`,
 * a real foreign key pointing the other way.
 */
export const invoiceDetails = pgTable("invoice_details", {
  documentId: uuid("document_id")
    .primaryKey()
    .references(() => documents.id, { onDelete: "cascade" }),

  invoiceType: invoiceTypeEnum("invoice_type").notNull(),
  amountDueCents: bigint("amount_due_cents", { mode: "number" })
    .notNull()
    .default(0),
  dueOn: date("due_on"),
  covers: text("covers"),

  /** When the gate this draw depends on was cleared. Moves after the freeze. */
  gateMetAt: timestamp("gate_met_at", { withTimezone: true }),
  /** The withdrawal. Also moves after the freeze — §7 requires it. */
  voidedAt: timestamp("voided_at", { withTimezone: true }),
});

/* ── The Scope tree ───────────────────────────────────────────────────── */

/**
 * A row of the Scope section — Documents §3.
 *
 * **Nodes belong to a document, and a generated document gets copies.** The
 * Contract carries the full agreed scope rather than a summary, so it cannot
 * read its scope out of a document it superseded; and a Contract can exist with
 * no Quote behind it, which under a shared-node model would leave it with no
 * rows at all. `copiedFromNodeId` keeps the lineage.
 *
 * The consequence that matters downstream: a change order's reference points at
 * the **contract's** node, which is exactly what allowance settlement and
 * deduct change orders need.
 *
 * Ordered by `position` across the whole tree rather than per level, so one
 * `order by position` reproduces what the contractor sees.
 */
export const scopeNodes = pgTable(
  "scope_nodes",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    documentId: uuid("document_id")
      .notNull()
      .references(() => documents.id, { onDelete: "cascade" }),

    /**
     * The containing node. Null at the root.
     *
     * Cascades: deleting a group deletes what was inside it, which is what the
     * contractor means by deleting a group. Breaking a bundle apart re-parents
     * the children first.
     */
    parentNodeId: uuid("parent_node_id").references(
      (): AnyPgColumn => scopeNodes.id,
      { onDelete: "cascade" }
    ),
    position: integer("position").notNull().default(0),

    nodeType: lineItemTypeEnum("node_type").notNull().default("item"),
    /** The cost bucket, on priced leaves only. */
    section: lineItemSectionEnum("section"),
    /** A priced row she may add or leave off. Inherited by children. */
    optional: boolean("optional").notNull().default(false),

    description: text("description").notNull(),
    quantity: numeric("quantity", { precision: 12, scale: 3 })
      .notNull()
      .default("1"),
    unit: text("unit"),

    /** Never shown to the homeowner. */
    unitCostCents: bigint("unit_cost_cents", { mode: "number" }),
    /** Basis points. 3500 = 35%. Integers, like every other money field. */
    markupBps: integer("markup_bps"),
    /**
     * What she pays per unit. **Stored, not recomputed** — a document is a
     * record of what was offered, not a formula re-evaluated later against a
     * price book that has since moved.
     */
    sellPriceCents: bigint("sell_price_cents", { mode: "number" })
      .notNull()
      .default(0),

    taxable: boolean("taxable").notNull().default(true),

    /** Pack-specific fields only. Never core money. */
    details: jsonb("details").$type<Record<string, unknown>>().notNull().default({}),

    source: lineItemSourceEnum("source").notNull().default("typed"),
    /** The node this was copied from when a document generated another. */
    copiedFromNodeId: uuid("copied_from_node_id").references(
      (): AnyPgColumn => scopeNodes.id,
      { onDelete: "set null" }
    ),

    /* ── Cross-references — §4 ──────────────────────────────────────── */

    /** The contracted node this change-order line acts on. */
    referencesNodeId: uuid("references_node_id").references(
      (): AnyPgColumn => scopeNodes.id,
      { onDelete: "set null" }
    ),
    referenceKind: scopeReferenceKindEnum("reference_kind"),

    /**
     * Allowance settlement, written **onto the allowance node itself**.
     *
     * So that "has this settled" is answerable without walking every change
     * order. These are the only two columns that may be written after their
     * document freezes, because the allowance lives on the Contract and the
     * Contract is frozen the moment it is signed.
     */
    allowanceSettledCents: bigint("allowance_settled_cents", { mode: "number" }),
    allowanceSettledAt: timestamp("allowance_settled_at", {
      withTimezone: true,
    }),

    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("scope_nodes_document_idx").on(
      t.documentId,
      t.parentNodeId,
      t.position
    ),
    index("scope_nodes_references_idx").on(t.referencesNodeId),
    index("scope_nodes_copied_from_idx").on(t.copiedFromNodeId),

    /**
     * A priced leaf lands in a bucket; nothing else may claim one.
     *
     * Carried over from `line_items`, where it has been doing real work: a
     * container takes its money from its children and a note has no money at
     * all. Written as an equivalence so neither half can be relaxed without
     * the other being reconsidered.
     */
    check(
      "scope_nodes_bucket_matches_type",
      sql`(${t.nodeType} in ('item', 'allowance')) = (${t.section} is not null)`
    ),

    /** A reference and its kind are meaningless apart. */
    check(
      "scope_nodes_reference_is_complete",
      sql`(${t.referencesNodeId} is null) = (${t.referenceKind} is null)`
    ),

    /** Only an allowance settles. */
    check(
      "scope_nodes_settlement_is_an_allowance",
      sql`${t.allowanceSettledCents} is null or ${t.nodeType} = 'allowance'`
    ),
  ]
);

/* ── Options ──────────────────────────────────────────────────────────── */

/**
 * A version of the job she picks between, on a tiered Quote.
 *
 * **Options name a subset of the tree; they do not own a copy.** Repricing a
 * condenser across three tiers has to edit one node, or the tiers drift apart
 * and the comparison stops holding together.
 */
export const documentOptions = pgTable(
  "document_options",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    documentId: uuid("document_id")
      .notNull()
      .references(() => documents.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    summary: text("summary"),
    position: integer("position").notNull().default(0),
    recommended: boolean("recommended").notNull().default(false),
  },
  (t) => [index("document_options_document_idx").on(t.documentId)]
);

export const optionNodes = pgTable(
  "option_nodes",
  {
    optionId: uuid("option_id")
      .notNull()
      .references(() => documentOptions.id, { onDelete: "cascade" }),
    nodeId: uuid("node_id")
      .notNull()
      .references(() => scopeNodes.id, { onDelete: "cascade" }),
  },
  (t) => [primaryKey({ columns: [t.optionId, t.nodeId] })]
);

/* ── Signatures ───────────────────────────────────────────────────────── */

/**
 * Signing, in-house — Documents §6.
 *
 * No third-party e-signature integration: no envelope round-trip, no webhook,
 * and the signed artifact lives here rather than on a vendor's system.
 *
 * **Its own table, not columns on the contract.** A signature is an audit
 * record — who, when, from where — and audit records are appended rather than
 * overwritten. It also lets a change-order approval be recorded the same way
 * without inventing a second mechanism.
 *
 * The five captured fields are what the dispute packet needs and what ESIGN and
 * UETA expect a record of intent to carry.
 */
export const documentSignatures = pgTable(
  "document_signatures",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    documentId: uuid("document_id")
      .notNull()
      .references(() => documents.id, { onDelete: "cascade" }),

    party: signaturePartyEnum("party").notNull(),
    printedName: text("printed_name").notNull(),
    /** The drawn image as an SVG path or PNG data URL, or the typed mark. */
    signatureData: text("signature_data").notNull(),
    signatureKind: signatureKindEnum("signature_kind").notNull().default("typed"),

    signedAt: timestamp("signed_at", { withTimezone: true })
      .notNull()
      .defaultNow(),

    /**
     * When they agreed to do this electronically — ESIGN §101(c).
     *
     * **The requirement most in-house e-signature implementations miss.** A
     * signature is not enforceable against a consumer unless they consented to
     * electronic records first, after a disclosure telling them they may
     * request paper and how to withdraw. So consent is recorded as its own
     * timestamp rather than assumed from the fact that they clicked: "they
     * signed, therefore they consented" is exactly the reasoning an issuer
     * discounts.
     */
    consentedAt: timestamp("consented_at", { withTimezone: true }),

    /**
     * SHA-256 of the document's content at the moment it was signed.
     *
     * **What logically associates the signature with the record**, which ESIGN
     * requires and which a foreign key alone does not provide: a key says
     * "these rows are related", a hash says "the thing I signed said exactly
     * this". The freeze already makes the document immutable, so in practice
     * these must always match — and the point is that a packet can *demonstrate*
     * it rather than asking anyone to trust our triggers.
     */
    documentHash: text("document_hash"),

    /** Who we believed we were sending it to. Attribution evidence. */
    signerEmail: text("signer_email"),
    authMethod: signatureAuthMethodEnum("auth_method")
      .notNull()
      .default("account"),

    ip: text("ip"),
    userAgent: text("user_agent"),
  },
  (t) => [
    index("document_signatures_document_idx").on(t.documentId),
    // One signature per party per document. A second is a re-sign, which is a
    // different act and needs a different document.
    uniqueIndex("document_signatures_party_unique").on(t.documentId, t.party),
  ]
);

/* ── Sends ────────────────────────────────────────────────────────────── */

/**
 * Every time a document went out, and how.
 *
 * `documents.sent_at` says *when it first* went; this says each time, by which
 * channel, to whom and with what message. A resend is a real event — "I sent it
 * again Thursday and she opened it an hour later" — and the dispute packet's
 * timeline needs every one of them, so they are appended rather than written
 * over a column.
 *
 * **Its own table, not columns on the document**, for the same reason as
 * signatures: an issued invoice is frozen, and whether it was emailed again is a
 * fact about what happened next, not about what was agreed.
 */
export const documentSends = pgTable(
  "document_sends",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    documentId: uuid("document_id")
      .notNull()
      .references(() => documents.id, { onDelete: "cascade" }),

    /**
     * `email` went through the product. `link` was copied for him to paste
     * wherever he already talks to the customer. `text` waits on a provider.
     */
    channel: text("channel").notNull(),
    /** The address it was emailed to. Null when the link was copied instead. */
    recipient: text("recipient"),
    /** His message, as it went. The link always rides underneath it. */
    message: text("message"),

    sentBy: uuid("sent_by").references(() => authUsers.id, {
      onDelete: "set null",
    }),
    sentAt: timestamp("sent_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("document_sends_document_idx").on(t.documentId, t.sentAt),
    check(
      "document_sends_channel",
      sql`${t.channel} in ('email', 'link', 'text')`
    ),
  ]
);

/* ── Relations ────────────────────────────────────────────────────────── */

export const documentsRelations = relations(documents, ({ one, many }) => ({
  organization: one(organizations, {
    fields: [documents.organizationId],
    references: [organizations.id],
  }),
  job: one(jobs, { fields: [documents.jobId], references: [jobs.id] }),
  customer: one(customers, {
    fields: [documents.customerId],
    references: [customers.id],
  }),
  source: one(documents, {
    fields: [documents.sourceDocumentId],
    references: [documents.id],
    relationName: "generated_from",
  }),
  quote: one(quoteDetails, {
    fields: [documents.id],
    references: [quoteDetails.documentId],
  }),
  contract: one(contractDetails, {
    fields: [documents.id],
    references: [contractDetails.documentId],
  }),
  changeOrder: one(changeOrderDetails, {
    fields: [documents.id],
    references: [changeOrderDetails.documentId],
  }),
  invoice: one(invoiceDetails, {
    fields: [documents.id],
    references: [invoiceDetails.documentId],
  }),
  scope: many(scopeNodes),
  options: many(documentOptions),
  signatures: many(documentSignatures),
  sends: many(documentSends),
}));

export const documentSendsRelations = relations(documentSends, ({ one }) => ({
  document: one(documents, {
    fields: [documentSends.documentId],
    references: [documents.id],
  }),
}));

export type DocumentSend = typeof documentSends.$inferSelect;

export const scopeNodesRelations = relations(scopeNodes, ({ one }) => ({
  document: one(documents, {
    fields: [scopeNodes.documentId],
    references: [documents.id],
  }),
  parent: one(scopeNodes, {
    fields: [scopeNodes.parentNodeId],
    references: [scopeNodes.id],
    relationName: "containment",
  }),
  copiedFrom: one(scopeNodes, {
    fields: [scopeNodes.copiedFromNodeId],
    references: [scopeNodes.id],
    relationName: "lineage",
  }),
  references: one(scopeNodes, {
    fields: [scopeNodes.referencesNodeId],
    references: [scopeNodes.id],
    relationName: "amendment",
  }),
}));

/**
 * Declared so the relational loader can resolve `documents.options`.
 *
 * Drizzle needs both sides of a `many`/`one` pair to build the join; without
 * the `one` here, `db.query.documents` fails at query-build time with "not
 * enough information to infer relation" rather than at type-check.
 */
export const documentOptionsRelations = relations(
  documentOptions,
  ({ one, many }) => ({
    document: one(documents, {
      fields: [documentOptions.documentId],
      references: [documents.id],
    }),
    nodes: many(optionNodes),
  })
);

export const optionNodesRelations = relations(optionNodes, ({ one }) => ({
  option: one(documentOptions, {
    fields: [optionNodes.optionId],
    references: [documentOptions.id],
  }),
  node: one(scopeNodes, {
    fields: [optionNodes.nodeId],
    references: [scopeNodes.id],
  }),
}));

export const documentSignaturesRelations = relations(
  documentSignatures,
  ({ one }) => ({
    document: one(documents, {
      fields: [documentSignatures.documentId],
      references: [documents.id],
    }),
  })
);

export type DocumentRow = typeof documents.$inferSelect;
export type NewDocumentRow = typeof documents.$inferInsert;
export type QuoteDetails = typeof quoteDetails.$inferSelect;
export type ContractDetails = typeof contractDetails.$inferSelect;
export type ChangeOrderDetails = typeof changeOrderDetails.$inferSelect;
export type InvoiceDetails = typeof invoiceDetails.$inferSelect;
export type ScopeNode = typeof scopeNodes.$inferSelect;
export type NewScopeNode = typeof scopeNodes.$inferInsert;
export type DocumentOption = typeof documentOptions.$inferSelect;
export type DocumentSignature = typeof documentSignatures.$inferSelect;
