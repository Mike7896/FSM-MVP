import "server-only";

import { randomUUID } from "node:crypto";

import { and, eq, notInArray } from "drizzle-orm";

import { scopeNodes, type NewScopeNode } from "@/lib/db/schema";

import type { Executor } from "./repository";

/**
 * Writing a document's Scope tree — Documents §3.
 *
 * The editor sends the tree **whole, flattened in document order**, rather than
 * as per-node creates, updates and deletes. A quote's rows are tens, not
 * thousands, and they are one document: sending it whole lets the server
 * replace it in one transaction, and reordering, regrouping and reparenting all
 * come free instead of each being a patch across every row.
 */

/** One node as it arrives on the wire. */
export type IncomingScopeNode = {
  referencesNodeId?: string | null;
  referenceKind?: "deletes" | "settles" | null;
  /** Null for a node that has never been saved. */
  id: string | null;
  /**
   * Where this node's parent sits in the same array. Null at the root.
   *
   * **An index, not an id**: a new node has no id until it is written, and a
   * child's parent may be new too. The array is in document order, so a parent
   * always comes before its children.
   */
  parentIndex: number | null;
  nodeType: (typeof scopeNodes.nodeType.enumValues)[number];
  section: (typeof scopeNodes.section.enumValues)[number] | null;
  description: string;
  quantity: number;
  unit: string | null;
  unitCostCents: number | null;
  markupBps: number | null;
  sellPriceCents: number;
  taxable: boolean;
  optional: boolean;
  /** Groups and assemblies only. Absent or null follows the quote's setting. */
  breakdown?: (typeof scopeNodes.breakdown.enumValues)[number] | null;
  position: number;
  source: (typeof scopeNodes.source.enumValues)[number];
};

type Owner = { documentId: string; organizationId: string };

/**
 * The wire's flattened tree, as rows.
 *
 * **Ids are assigned here, before anything is written.** A parent is named by
 * index and may itself be new, so the id map has to be complete before the
 * first insert — otherwise resolving a parent would cost a round trip per level
 * of nesting.
 *
 * An id the client sent that is **not** already on this document is treated as
 * new rather than as an update that quietly matches nothing. That happens when
 * a quote was edited in two tabs, and the alternative is a row the contractor
 * can see that never reaches the database.
 *
 * **So is an id sent twice.** Only its first row keeps it; a second row
 * claiming the same id would otherwise be written over the first, and one of
 * the two rows the contractor can see would be gone from the database.
 */
export function resolveScopeNodes(
  owner: Owner,
  nodes: IncomingScopeNode[],
  existing: Set<string>
): { rows: NewScopeNode[]; keep: string[] } {
  const claimed = new Set<string>();
  const ids = nodes.map((node) => {
    if (node.id && existing.has(node.id) && !claimed.has(node.id)) {
      claimed.add(node.id);
      return node.id;
    }
    return randomUUID();
  });

  const keep: string[] = [];

  const rows = nodes.map((node, index): NewScopeNode => {
    const id = ids[index];
    if (existing.has(id)) keep.push(id);

    return {
      id,
      referencesNodeId: node.referencesNodeId ?? null,
      referenceKind: node.referenceKind ?? null,
      organizationId: owner.organizationId,
      documentId: owner.documentId,
      parentNodeId: node.parentIndex === null ? null : ids[node.parentIndex],
      position: index,
      nodeType: node.nodeType,
      section: node.section,
      optional: node.optional,
      // Only a group or an assembly has rows inside to show or hide; the
      // database refuses it anywhere else.
      breakdown:
        node.nodeType === "group" || node.nodeType === "assembly"
          ? (node.breakdown ?? null)
          : null,
      description: node.description,
      // `numeric` takes a string; a float is how a quantity ends up stored as
      // 2.0000000000000004.
      quantity: String(node.quantity),
      unit: node.unit,
      unitCostCents: node.unitCostCents,
      markupBps: node.markupBps,
      sellPriceCents: node.sellPriceCents,
      taxable: node.taxable,
      source: node.source,
    };
  });

  return { rows, keep };
}

/**
 * Replaces a document's Scope tree with the one sent.
 *
 * **The order of the four statements is the whole of this function**, and each
 * is there because leaving it out loses rows:
 *
 * 1. **Detach first.** `parent_node_id` cascades on delete, so dropping a group
 *    would take its children with it — and "break this bundle apart" is exactly
 *    the motion that keeps the children and drops the parent.
 * 2. **Delete what is gone**, by id rather than wholesale. An option names nodes
 *    by id and a permit's fee points at one, so replacing the whole tree on
 *    every save would empty every tier and orphan the fee.
 * 3. **Insert the new rows in one statement.** Referential integrity is checked
 *    at the end of the statement, so a parent and its children land together.
 * 4. **Update the survivors last**, once any new parent they point at exists.
 *
 * Takes the caller's transaction: the tree and the document it belongs to are
 * one write, and a tree committed beside a rolled-back document is a quote that
 * disagrees with itself.
 */
export async function writeScopeTree(
  tx: Executor,
  owner: Owner,
  nodes: IncomingScopeNode[]
): Promise<void> {
  const present: { id: string }[] = await tx
    .select({ id: scopeNodes.id })
    .from(scopeNodes)
    .where(eq(scopeNodes.documentId, owner.documentId));

  const existing = new Set(present.map((row) => row.id));
  const { rows, keep } = resolveScopeNodes(owner, nodes, existing);
  const keepSet = new Set(keep);

  // 1.
  await tx
    .update(scopeNodes)
    .set({ parentNodeId: null })
    .where(eq(scopeNodes.documentId, owner.documentId));

  // 2. `notInArray` over an empty list is invalid SQL, hence the branch.
  await tx
    .delete(scopeNodes)
    .where(
      keep.length
        ? and(
            eq(scopeNodes.documentId, owner.documentId),
            notInArray(scopeNodes.id, keep)
          )
        : eq(scopeNodes.documentId, owner.documentId)
    );

  // 3.
  const fresh = rows.filter((row) => !keepSet.has(row.id!));
  if (fresh.length) await tx.insert(scopeNodes).values(fresh);

  // 4. One statement per survivor — tens of rows, inside the transaction.
  for (const row of rows.filter((candidate) => keepSet.has(candidate.id!))) {
    await tx
      .update(scopeNodes)
      .set(row)
      .where(
        and(
          eq(scopeNodes.id, row.id!),
          eq(scopeNodes.documentId, owner.documentId)
        )
      );
  }
}
