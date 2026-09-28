import type {
  ChangeOrderDetails,
  ContractDetails,
  DocumentOption,
  DocumentSignature,
  HeaderSnapshot,
  InvoiceDetails,
  QuoteDetails,
  ScopeNode,
} from "@/lib/db/schema";

import type { DocumentStatus, DocumentType } from "./lifecycle";

/**
 * ONE INTERFACE, FOUR EXTENSIONS — Documents §10.
 *
 * No inheritance hierarchy beyond this and no abstract transformation class.
 * The nine operations are ordinary functions over these types, because they are
 * genuinely different pieces of logic rather than nine settings on one routine.
 *
 * The engine-shaped part of this product is elsewhere: the six price structures
 * are six projections of one Scope tree onto the customer's page, and that is
 * rule-driven rendering that *reads* these types without changing them.
 */

export type { DocumentStatus, DocumentType, HeaderSnapshot };

/** What the four share — §2's spine. */
export type DocumentBase = {
  id: string;
  organizationId: string;
  jobId: string;
  customerId: string | null;

  type: DocumentType;
  /** Human-facing and per type — `Q-0007`. */
  number: string;
  status: DocumentStatus;

  /** What generated this one. Null when nothing did, which is legitimate. */
  sourceDocumentId: string | null;

  title: string | null;
  summary: string | null;
  termsText: string | null;
  /** Frozen at send. Never a live join — see the schema module. */
  header: HeaderSnapshot;
  packId: string | null;

  issuedAt: Date | null;
  sentAt: Date | null;
  viewedAt: Date | null;
  /** Non-null means immutable. */
  frozenAt: Date | null;

  createdBy: string | null;
  createdAt: Date;
  updatedAt: Date;

  /**
   * Flat, in `position` order across the whole tree.
   *
   * Assembled into a tree by `parentNodeId` where a caller needs one — see
   * `buildScopeTree`. Kept flat here because most callers sum it rather than
   * walk it, and a document-order array is what a single `order by position`
   * already produces.
   */
  scope: ScopeNode[];
  options: DocumentOption[];
  signatures: DocumentSignature[];
};

export type QuoteDocument = DocumentBase & {
  type: "quote";
  details: QuoteDetails | null;
};

export type ContractDocument = DocumentBase & {
  type: "contract";
  details: ContractDetails | null;
};

export type ChangeOrderDocument = DocumentBase & {
  type: "change_order";
  details: ChangeOrderDetails | null;
};

export type InvoiceDocument = DocumentBase & {
  type: "invoice";
  details: InvoiceDetails | null;
};

/**
 * Any of the four.
 *
 * A discriminated union on `type`, so narrowing one of these gives the right
 * `details` for free and a caller cannot read `amountDueCents` off a quote.
 */
export type AnyDocument =
  | QuoteDocument
  | ContractDocument
  | ChangeOrderDocument
  | InvoiceDocument;

/** A Scope node with its children attached — the shape an editor renders. */
export type ScopeTreeNode = ScopeNode & { children: ScopeTreeNode[] };

/**
 * Assembles the flat array into a tree.
 *
 * `position` is document order across the *whole* tree rather than per level,
 * so the flat array is already in reading order and this only has to attach
 * children to parents — no sorting per level, no second pass.
 *
 * A node whose parent is missing from the array (a filtered subset, a partial
 * load) is treated as a root rather than dropped. Silently losing a priced row
 * because its group was filtered out is how a total goes quietly wrong.
 */
export function buildScopeTree(nodes: readonly ScopeNode[]): ScopeTreeNode[] {
  const byId = new Map<string, ScopeTreeNode>();
  for (const node of nodes) byId.set(node.id, { ...node, children: [] });

  const roots: ScopeTreeNode[] = [];
  for (const node of nodes) {
    const attached = byId.get(node.id)!;
    const parent = node.parentNodeId ? byId.get(node.parentNodeId) : undefined;
    if (parent) parent.children.push(attached);
    else roots.push(attached);
  }

  return roots;
}
