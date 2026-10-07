/** Exercise the real metric readers against a recording executor; no database connection. */
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { build } from 'esbuild';
import { PgDialect } from 'drizzle-orm/pg-core';
const require = createRequire(import.meta.url);
const statements = [];
const dialect = new PgDialect();
globalThis.__adminExecute = async (query) => {
  const compiled = dialect.sqlToQuery(query);
  statements.push(compiled.sql);
  if (compiled.sql.includes("coalesce(pr.name, 'Unknown plan')")) return [{ status: 'active', plan: 'Pro', count: 2, mrr_cents: 9800, estimated: 0 }];
  return [];
};
const stubs = {
  'server-only': '',
  '@/lib/db': 'export const db={execute:query=>globalThis.__adminExecute(query)};',
  '@/lib/env': 'export const serverEnv=()=>({});',
};
const bundle = await build({
  stdin: { contents: `export {getAdminMetrics,getAdminMetricGroup} from './lib/admin/metrics';`, resolveDir: process.cwd() },
  platform: 'node', format: 'cjs', bundle: true, write: false,
  plugins: [{ name: 'record-database-queries', setup(b) {
    b.onResolve({ filter: /.*/ }, args => Object.hasOwn(stubs,args.path) ? { path: args.path, namespace: 'stub' } : undefined);
    b.onLoad({ filter: /.*/, namespace: 'stub' }, args => ({ contents: stubs[args.path], loader: 'js' }));
  } }],
});
const compiledModule = { exports: {} };
new Function('module', 'exports', 'require', bundle.outputFiles[0].text)(compiledModule, compiledModule.exports, require);
const { getAdminMetrics, getAdminMetricGroup } = compiledModule.exports;
try {
  const full = await getAdminMetrics('America/New_York');
  assert.equal(statements.length, 32);
  const fullQueries = [...statements].sort();
  const parts = {};
  const selectedQueries = [];
  for (const [group, expected] of Object.entries({ activity: 5, business: 5, revenue: 10, engagement: 6, support: 4, system: 2 })) {
    statements.length = 0;
    const result = await getAdminMetricGroup('America/New_York', group);
    assert.equal(statements.length, expected, `${group} executes only its queries`);
    if (group === 'engagement') assert.ok(statements.every(sql => !/from (subscriptions|billing_accounts|mrr_changes|platform_usage)|pg_stat_user_tables/.test(sql)));
    if (group === 'support') assert.ok(statements.every(sql => !/from (subscriptions|mrr_changes|user_activity_hours)|pg_database_size/.test(sql)));
    Object.assign(parts, result);
    selectedQueries.push(...statements);
    console.log(`PASS ${group}: ${expected} queries; unrelated readers skipped`);
  }
  assert.deepEqual(selectedQueries.sort(), fullQueries, 'Split reads preserve the full set of SQL queries');
  const { founderRevenue, founderUsage, ...merged } = parts;
  merged.founder = { ...founderRevenue, usage: founderUsage };
  delete full.generatedAt;
  delete merged.generatedAt;
  assert.deepEqual(merged, full, 'Full and split responses produce identical metrics');
  assert.equal(full.revenue.mrrCents, 9800);
  assert.equal(full.founder.revenue.arrCents, 117600);
  console.log('PASS split/full snapshots match, including revenue calculations and all 32 SQL queries');
} finally { delete globalThis.__adminExecute; }
