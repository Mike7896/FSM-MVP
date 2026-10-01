import type { ScopeNode } from "@/lib/db/schema";

import { scopeTotals, type ScopeTotals } from "../scope";
import type { ChangeOrderDocument, ContractDocument } from "../types";

/**
 * `currentAgreedScope` — Documents §8, operation 7.
 *
 * **The only one of the nine that writes nothing.** It is the same fold shape
 * the ledger uses — a starting state plus ordered events reduced to an answer —
 * and it is what the Job hub means by *what am I building right now*.
 *
 * It is deliberately **not materialized**. There is no work-order document and
 * there is not going to be one: the Contract carries the full agreed scope, and
 * "what am I building after three change orders" is a view assembled here
 * rather than a fourth document somebody has to keep in step with the other
 * three. A stored copy is a copy that goes stale the first time a change order
 * is approved without it.
 *
 * Pure — a contract, its approved change orders, and nothing else. No database,
 * which is what makes the arithmetic testable.
 */

/** A row of the current agreed scope, with where it came from. */
export type AgreedNode = ScopeNode & {
  /**
   * Which document put this row here.
   *
   * The hub shows added work differently from contracted work, and a contractor
   * reading "why is this here" needs the change order's number, not a boolean.
   */
  origin: { documentId: string; number: string; type: "contract" | "change_order" };
  /** Set on an allowance that a change order has closed. */
  settledCents?: number;
};

export type AgreedScope = {
  /** The current tree, flat, in document order. */
  nodes: AgreedNode[];
  totals: ScopeTotals;

  /** The AIA number set the money card renders, settled in the ledger design. */
  originalContractSumCents: number;
  netChangeCents: number;
  contractSumToDateCents: number;

  applied: {
    documentId: string;
    number: string;
    deltaCents: number;
    approvedAt: Date | null;
  }[];
};

/**
 * Folds a contract and its approved change orders into what is agreed now.
 *
 * Only **approved** change orders participate. A draft or a sent one is a
 * proposal, and putting a proposal into the agreed scope would tell a
 * contractor to build something the homeowner has not said yes to — which is
 * the expensive direction of that error.
 */
export function currentAgreedScope(
  contract: ContractDocument,
  changeOrders: readonly ChangeOrderDocument[]
): AgreedScope {
  // Working set keyed by node id, so a supersede can find its target in one
  // lookup rather than a scan per change-order line.
  const working = new Map<string, AgreedNode>();
  const order: string[] = [];

  const contractOrigin = {
    documentId: contract.id,
    number: contract.number,
    type: "contract" as const,
  };

  for (const node of contract.scope) {
    working.set(node.id, { ...node, origin: contractOrigin });
    order.push(node.id);
  }

  const approved = changeOrders
    .filter((co) => co.status === "approved")
    // By approval time, because that is the order they became binding.
    // Two approved in the same second fall back to the number, which is
    // monotonic per shop.
    .sort((a, b) => {
      const at = a.details?.approvedAt?.getTime() ?? 0;
      const bt = b.details?.approvedAt?.getTime() ?? 0;
      return at === bt ? a.number.localeCompare(b.number) : at - bt;
    });

  const applied: AgreedScope["applied"] = [];

  for (const changeOrder of approved) {
    const origin = {
      documentId: changeOrder.id,
      number: changeOrder.number,
      type: "change_order" as const,
    };

    for (const node of changeOrder.scope) {
      const targetId = node.referencesNodeId;

      switch (node.referenceKind) {
        case "deletes": {
          // Removed work. The row leaves the agreed scope entirely; the change
          // order remains the record that it was ever there.
          if (targetId) {
            working.delete(targetId);
            const at = order.indexOf(targetId);
            if (at >= 0) order.splice(at, 1);
          }
          break;
        }

        case "supersedes": {
          // Replaced work. The replacement takes the original's **position**,
          // so the document still reads top to bottom the way it was written —
          // a superseded row jumping to the bottom of the scope makes a
          // three-change-order job unreadable.
          if (targetId && working.has(targetId)) {
            working.delete(targetId);
            const at = order.indexOf(targetId);
            if (at >= 0) order.splice(at, 1, node.id);
            else order.push(node.id);
          } else {
            order.push(node.id);
          }
          working.set(node.id, { ...node, origin });
          break;
        }

        case "settles": {
          // An allowance closing at a known amount. The settlement lands on the
          // allowance itself rather than adding a row, because §4 makes "has
          // this settled" a question about the allowance — and because the
          // customer agreed to one fixture line, not to a fixture line plus a
          // settlement line.
          const target = targetId ? working.get(targetId) : undefined;
          if (target) {
            working.set(target.id, {
              ...target,
              settledCents:
                target.allowanceSettledCents ?? computeLeafAmount(node),
            });
          }
          break;
        }

        default: {
          // Added work — no reference, so it stands on its own.
          working.set(node.id, { ...node, origin });
          order.push(node.id);
        }
      }
    }

    applied.push({
      documentId: changeOrder.id,
      number: changeOrder.number,
      deltaCents: changeOrder.details?.deltaCents ?? 0,
      approvedAt: changeOrder.details?.approvedAt ?? null,
    });
  }

  const nodes = order
    .map((id) => working.get(id))
    .filter((node): node is AgreedNode => node !== undefined);

  const originalContractSumCents = contract.details?.contractSumCents ?? 0;
  const netChangeCents = applied.reduce((sum, co) => sum + co.deltaCents, 0);

  return {
    nodes,
    // Totals are read from the folded scope rather than from the contract sum,
    // so a change order that adds a row and a change order that adds a delta
    // cannot silently disagree. Where they do, the consistency check job is
    // what surfaces it.
    totals: scopeTotals(nodes.map(node => node.settledCents === undefined ? node : { ...node, quantity: "1", sellPriceCents: node.settledCents })),
    originalContractSumCents,
    netChangeCents,
    contractSumToDateCents: originalContractSumCents + netChangeCents,
    applied,
  };
}

function computeLeafAmount(node: ScopeNode): number {
  return Math.round(Number(node.quantity) * node.sellPriceCents);
}
