import "server-only";

import { sql, type SQL } from "drizzle-orm";

/**
 * The Scope tree's arithmetic, in SQL, written once.
 *
 * **This has to agree with `lib/quote/totals.ts` and `lib/documents/scope.ts`
 * exactly.** Those run in the contractor's browser, on the homeowner's page and
 * on the server when a Contract is generated; this runs on the quotes list, the
 * dashboard and the job hub. If they disagree, the same quote shows one total
 * in the editor and another in the list — the single most trust-destroying bug
 * this product can ship.
 *
 * The three rules, matching `totals()` line for line:
 *
 * 1. **Only priced leaves carry money.** A group's subtotal and an assembly's
 *    rollup come from their children everywhere; summing a container as well as
 *    its descendants would double-count every bundle.
 * 2. **Optional rows are not in the price**, and optional is *inherited* — a row
 *    inside an optional group is optional whatever its own column says. That
 *    inheritance is the only reason this needs a recursive walk rather than a
 *    `where` clause.
 * 3. **Tax applies to rows that are `taxable` and are not labor.**
 */

/**
 * What one document's Scope comes to, tax included — a correlated scalar.
 *
 * `documentRef` and `taxRateRef` are the outer query's columns and must be
 * **qualified**: Drizzle renders an embedded column unqualified inside a `sql`
 * template, and `id` is ambiguous against the `scope_nodes` in the walk below.
 * Pass `sql.raw('"documents"."id"')` from a correlated position.
 */
export function scopeTotalExpression(documentRef: SQL, taxRateRef: SQL): SQL {
  return sql`coalesce((
    with recursive scope as (
      select n.id, n.node_type, n.section, n.quantity,
             n.sell_price_cents, n.taxable, n.optional
      from scope_nodes n
      where n.document_id = ${documentRef} and n.parent_node_id is null

      union all

      select child.id, child.node_type, child.section, child.quantity,
             child.sell_price_cents, child.taxable,
             -- Rule 2. An optional container makes everything under it
             -- optional, however the child's own column reads.
             (child.optional or parent.optional)
      from scope_nodes child
      join scope parent on child.parent_node_id = parent.id
    )
    select round(
      sum(s.quantity * s.sell_price_cents)
      + sum(s.quantity * s.sell_price_cents)
          filter (where s.section <> 'labor' and s.taxable)
        * coalesce(${taxRateRef}, 0)
    )::bigint
    from scope s
    -- Rules 1 and 2.
    where s.node_type in ('item', 'allowance') and not s.optional
  ), 0)`;
}

/**
 * A quote's total, reading its tax rate off its own details.
 *
 * The common case: the caller has a quote's id and nothing else joined, and the
 * rate is one scalar lookup away.
 */
export function quoteTotalExpression(documentRef: SQL): SQL {
  return scopeTotalExpression(
    documentRef,
    sql`(select qd.tax_rate from quote_details qd where qd.document_id = ${documentRef})`
  );
}
