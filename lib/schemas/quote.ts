import { tagFilterShape } from "@/lib/tags";
import { z } from "zod";

/**
 * Quote and Scope validation, shared by the editor and the endpoint.
 *
 * The enum value lists are repeated here rather than imported from the Drizzle
 * schema, matching `job.ts` — these files stay importable from a client bundle,
 * and they are checked against `lib/db/schema/enums.ts` when either changes.
 *
 * **The wire speaks the document spine's words** — `summary`, `scope`,
 * `nodeType`, `markupBps` — because the native app is a client of the same
 * endpoints, and a second vocabulary at the boundary is a translation every
 * client has to get right.
 */

export const lineSectionValues = [
  "material",
  "labor",
  "equipment",
  "permit",
] as const;

/**
 * The seven kinds of Scope node. `group` and `assembly` are the two that take
 * children; the rest are leaves.
 */
export const lineTypeValues = [
  "item",
  "assembly",
  "group",
  "allowance",
  "note",
  "exclusion",
  "assumption",
] as const;

/** The two types that land in a cost bucket, and so must carry a `section`. */
const BUCKETED = new Set<string>(["item", "allowance"]);

/** The two types that may hold children. */
const CONTAINERS = new Set<string>(["group", "assembly"]);

export const lineSourceValues = [
  "typed",
  "template",
  "duplicated",
  "price_book",
  "ai_drafted",
] as const;

/** A quote's closed status set — `lib/documents/lifecycle.ts`. */
export const quoteStatusValues = [
  "draft",
  "sent",
  "viewed",
  "accepted",
  "declined",
  "expired",
] as const;

export const lineSectionSchema = z.enum(lineSectionValues);
export const lineTypeSchema = z.enum(lineTypeValues);
export const lineSourceSchema = z.enum(lineSourceValues);
export const quoteStatusSchema = z.enum(quoteStatusValues);

/**
 * The five decisions. Every field is optional and nullable: a quote is a valid,
 * saveable object before any of them has been decided, and forcing a choice up
 * front is what turns a two-minute quote into a configuration exercise.
 */
export const quoteTermsSchema = z.object({
  contractType: z
    .enum([
      "lump_sum",
      "unit_price",
      "cost_plus",
      "gmp",
      "time_and_materials",
      "flat_rate_menu",
    ])
    .nullable(),
  priceStructure: z
    .enum([
      "single_total",
      "itemized",
      "partitioned",
      "tiered",
      "menu",
      "two_part",
    ])
    .nullable(),
  /** On an itemised quote: the top-level rows, or every row. */
  scopeDetail: z.enum(["top", "all"]).nullable(),
  pricingMethod: z
    .enum(["cost_based", "competition_based", "value_based"])
    .nullable(),
  estimatingMethod: z
    .enum([
      "hourly_judgment",
      "labor_units",
      "assembly_unit_cost",
      "price_book_time",
      "parametric",
      "analogous",
      "production_rate",
    ])
    .nullable(),
  estimateClass: z
    .enum(["class_5", "class_4", "class_3", "class_2", "class_1"])
    .nullable(),
  billingTrigger: z
    .enum([
      "on_completion",
      "on_milestone",
      "on_percentage_complete",
      "on_schedule_of_values",
      "on_recurring_date",
    ])
    .nullable(),
  moneyUpFront: z.enum(["deposit", "mobilization", "none"]).nullable(),
  depositPercent: z.number().int().min(0).max(100).nullable(),
  progressBilling: z
    .enum(["draws", "progress_billing", "single_final_invoice"])
    .nullable(),
  retainagePercent: z.number().int().min(0).max(100).nullable(),
  capCents: z.number().int().min(0).nullable(),
  /**
   * The stages the work is billed in. Top-level rows name theirs by `key`, so
   * two phases sharing one would put a row in both.
   */
  phases: z
    .array(
      z.object({
        key: z.string().trim().min(1).max(40),
        name: z.string().trim().max(80),
        percent: z.number().min(0).max(100),
      })
    )
    .max(20)
    .refine(
      (phases) => new Set(phases.map((phase) => phase.key)).size === phases.length,
      { message: "Two phases share a key." }
    ),
  /** Split by the rows each phase covers, or by percent. */
  phaseSplit: z.enum(["scope", "percent"]).nullable(),
});

/**
 * One node of the Scope tree — a `scope_nodes` row on the wire.
 *
 * **Money is `int` cents and the schema refuses anything else.** A float here is
 * not a rounding inconvenience, it is a quote that does not add up. **Markup is
 * basis points** for the same reason: 3500 is 35%, and an integer survives a
 * round trip where a percentage float does not. `id` is null for a node that has
 * not been saved yet.
 *
 * **`parentIndex` is an index into the same array, not an id.** A new node has
 * no id until the server writes it, so a client-supplied parent id would either
 * be a UUID the client invented or a round trip per level of nesting.
 */
export const scopeNodeSchema = z.object({
  id: z.uuid().nullable(),
  parentIndex: z.number().int().min(0).nullable(),
  nodeType: lineTypeSchema,
  /** Null on containers and unpriced text — checked against `nodeType` below. */
  section: lineSectionSchema.nullable(),
  description: z.string().trim().max(500),
  quantity: z.number().min(0).max(1_000_000),
  unit: z.string().trim().max(20).nullable(),
  unitCostCents: z.number().int().min(0).nullable(),
  markupBps: z.number().int().min(-10_000).max(1_000_000).nullable(),
  sellPriceCents: z.number().int().min(0),
  taxable: z.boolean(),
  optional: z.boolean(),
  /** Groups and assemblies: show the customer the rows inside, or one line. */
  breakdown: z.enum(["show", "hide"]).nullable().optional(),
  /** Top-level rows: the `key` of the phase they're billed in. */
  phaseKey: z.string().trim().max(40).nullable().optional(),
  position: z.number().int().min(0),
  source: lineSourceSchema,
});

/**
 * The whole Scope tree, flattened in document order.
 *
 * The invariants checked here are the ones the database enforces one layer
 * down. Catching them in the schema turns a check-constraint violation — which
 * surfaces to the contractor as a failed autosave with no useful message — into
 * a named 422 the client can act on.
 */
export const scopeTreeSchema = z
  .array(scopeNodeSchema)
  .max(500)
  .superRefine((rows, ctx) => {
    rows.forEach((row, index) => {
      // Document order: a parent is always written before its children, so a
      // forward or self reference is a malformed tree rather than a deep one.
      if (row.parentIndex !== null) {
        if (row.parentIndex >= index) {
          ctx.addIssue({
            code: "custom",
            path: [index, "parentIndex"],
            message: "A row's parent must come before it in the list.",
          });
        } else if (!CONTAINERS.has(rows[row.parentIndex].nodeType)) {
          ctx.addIssue({
            code: "custom",
            path: [index, "parentIndex"],
            message: "Only a group or an assembly can hold rows.",
          });
        }
      }

      if (row.breakdown && !CONTAINERS.has(row.nodeType)) {
        ctx.addIssue({
          code: "custom",
          path: [index, "breakdown"],
          message: "Only a group or an assembly has rows inside to show.",
        });
      }

      // Type and cost bucket are orthogonal, but not independent: a priced leaf
      // lands in a bucket and nothing else may claim one.
      if (BUCKETED.has(row.nodeType) !== (row.section !== null)) {
        ctx.addIssue({
          code: "custom",
          path: [index, "section"],
          message: BUCKETED.has(row.nodeType)
            ? "A priced row needs a cost bucket."
            : "Only a priced row carries a cost bucket.",
        });
      }
    });
  });

/**
 * Creating a quote.
 *
 * **The only required field is a customer name**, and even that is permitted to
 * be a bare string rather than an id. The Job and the Customer are created
 * silently behind the document — the Job is the only prerequisite anywhere, and
 * every create path has to work from nothing. A contractor at a kitchen table
 * has a name and often nothing else.
 */
export const createQuoteSchema = z.object({
  /** Wins over `customerName` when both are sent. */
  customerId: z.uuid().optional(),
  customerName: z.string().trim().max(160).optional(),
  /** Supply to add a quote to a job that already exists. */
  jobId: z.uuid().optional(),
  title: z.string().trim().max(200).optional(),
  /** The Scope section's opening paragraph. */
  summary: z.string().max(8000).optional(),
  address: z.string().trim().max(300).optional(),
  taxRate: z.number().min(0).max(1).nullable().optional(),
  packId: z.string().trim().max(60).optional(),
  terms: quoteTermsSchema.partial().optional(),
  /** Whether the quote ends in signature lines. On when left out. */
  signatureLines: z.boolean().optional(),
  scope: scopeTreeSchema.optional(),
  /**
   * Built on the demo start. Makes a new demo Job and a new demo Customer —
   * never a match against a real one — and everything on them is left out of
   * every count, gate and money total.
   */
  demo: z.boolean().optional(),
});

export type CreateQuoteInput = z.infer<typeof createQuoteSchema>;

/**
 * Updating one.
 *
 * `scope` is **the whole tree or absent** — never a partial set. Sending the
 * document whole is what lets the server replace it in one transaction, and it
 * makes reordering, regrouping and reparenting free. An update that omits the
 * key does not touch Scope at all, so a terms-only change costs nothing.
 *
 * **Status is not here.** A quote moves through its statuses by what happens to
 * it — sent, opened, accepted — and each of those is its own operation with its
 * own rules. A field that set it directly would be a way around every one.
 */
export const updateQuoteSchema = z
  .object({
    customerId: z.uuid().nullable(),
    customerName: z.string().trim().max(160),
    title: z.string().trim().max(200).nullable(),
    summary: z.string().max(8000).nullable(),
    commitmentSummary: z.string().max(2000).nullable(),
    terms: quoteTermsSchema.partial(),
    taxRate: z.number().min(0).max(1).nullable(),
    licenseId: z.uuid().nullable(),
    signatureLines: z.boolean(),
    scope: scopeTreeSchema,
  })
  .partial()
  .refine((body) => Object.keys(body).length > 0, {
    message: "Send at least one field to change.",
  });

export type UpdateQuoteInput = z.infer<typeof updateQuoteSchema>;

/** Starting a new quote from an old one. */
export const duplicateQuoteSchema = z.object({
  /** Copy onto a job that already exists rather than making one. */
  jobId: z.uuid().optional(),
  customerId: z.uuid().optional(),
  customerName: z.string().trim().max(160).optional(),
  title: z.string().trim().max(200).optional(),
});

export type DuplicateQuoteInput = z.infer<typeof duplicateQuoteSchema>;

/**
 * Sending one — `POST /api/v1/quotes/[id]/send`.
 *
 * `email` delivers the link under his message; `link` records the send and
 * hands the link back for him to paste wherever he already talks to the
 * customer. A demo goes to the contractor's own sign-in address, or nowhere.
 */
export const sendQuoteSchema = z.object({
  channel: z.enum(["email", "link"]),
  to: z.email("Enter a valid email address.").optional(),
  /** The email's subject line. Left out, it is written from the quote. */
  subject: z.string().trim().max(200).optional(),
  message: z.string().trim().max(2000).optional(),
});

/**
 * `POST /api/v1/quotes/[id]/send/preview` — the email the send sheet is about
 * to send, drawn from the same composer the send uses.
 */
export const previewQuoteEmailSchema = z.object({
  subject: z.string().trim().max(200).optional(),
  message: z.string().trim().max(2000).optional(),
});

export type SendQuoteInput = z.infer<typeof sendQuoteSchema>;

export const listQuotesSchema = z.object({
  ...tagFilterShape,
  status: quoteStatusSchema.optional(),
  jobId: z.uuid().optional(),
  q: z.string().trim().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});
