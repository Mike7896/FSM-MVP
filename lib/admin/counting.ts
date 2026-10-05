import "server-only";

import { sql, type SQL } from "drizzle-orm";

/**
 * What counts on the admin dashboard — one set of rules for every number.
 *
 * Test (the check scripts' made-up data) and internal (the team's own accounts
 * and shops) are decided in the database, by `admin_is_test_org`/`_user` and
 * `admin_is_internal_org`/`_user` (drizzle/0046–0048) — the same functions the
 * event log asks as it writes, so the feed and the numbers can't disagree.
 */

/** A real shop, for a query that calls its organizations `o`. */
export const REAL_ORG = sql.raw(`not public.admin_is_test_org(o.id) and not public.admin_is_internal_org(o.id)`);

/** A line of the log that counts, for a query that reads `admin_events` unaliased or as its only table. */
export const COUNTED = sql.raw(`not test and not internal and not demo`);

/**
 * A real person, by user id: not a check script's throwaway account, not one
 * of ours, and not a tester made from the admin panel.
 */
export function realUser(id: SQL) {
  return sql`(
    not public.admin_is_test_user(${id})
    and not public.admin_is_internal_user(${id})
    and not exists (select 1 from account_policies tap where tap.user_id = ${id} and tap.kind = 'tester')
  )`;
}
