/** Real workflow functions with a recording database boundary. No credentials or network. */
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { build } from 'esbuild';
import { getTableName } from 'drizzle-orm';
import { PgDialect } from 'drizzle-orm/pg-core';

const require = createRequire(import.meta.url);
const dialect = new PgDialect();
let rows = [], calls = [], creations = [];
const executor = {
  select: () => query('select'), update: table => query('update', table),
  insert: table => query('insert', table), delete: table => query('delete', table),
  execute: async () => [],
  transaction: async work => work(executor),
};
function query(action, table) {
  const call = { action, table: table && getTableName(table) };
  const chain = {
    from(value) { call.table = getTableName(value); return chain; },
    where(value) { call.where = dialect.sqlToQuery(value); return chain; },
    set(value) { call.values = value; return chain; },
    values(value) { call.values = value; return chain; },
    for(value) { call.lock = value; return chain; },
    innerJoin() { return chain; }, leftJoin() { return chain; },
    orderBy() { return chain; }, limit() { return chain; }, returning() { return chain; },
    then(resolve, reject) {
      calls.push(call);
      const result = action === 'select' || action === 'insert' ? rows.shift() : [];
      assert.notEqual(result, undefined, `Unexpected query ${action} ${call.table}`);
      return Promise.resolve(result).then(resolve, reject);
    },
  };
  return chain;
}
function reset(results) { rows = results; calls = []; creations = []; }
const fixture = {
  type: 'quote', id: 'quote', customerId: 'customer', number: 'Q1', status: 'sent',
  header: { businessName: 'Shop', customerName: 'Homeowner' },
  details: { depositPercent: 30, taxRate: 0.06, drawPattern: [{ key: 'a', name: 'Phase', percent: 100 }] },
  scope: [{ id: 'item', position: 0, nodeType: 'item', quantity: 1, sellPriceCents: 10000, description: 'Work' }],
};
const state = globalThis.__workflowRegression = {
  executor, quote: structuredClone(fixture),
  link: { documentId: 'quote', organizationId: 'org', businessName: 'Shop' },
  load: async () => {
    assert.equal(calls.at(-1)?.lock, 'update', 'Review validation runs after obtaining the document lock');
    return state.quote;
  },
  create: async args => {
    assert.equal(args.on, executor, 'Issuance reuses the transaction holding the job lock');
    creations.push(args.input);
    return { id: 'replacement', number: 'INV2' };
  },
  accept: async () => { creations.push('contract'); return { id: 'contract', jobId: 'job' }; },
};
const stubs = {
  'server-only': '',
  '@/lib/db': 'export const db=globalThis.__workflowRegression.executor;',
  '@/lib/documents/repository': 'export const loadDocument=(...args)=>globalThis.__workflowRegression.load(...args);',
  './link': 'export const heldLink=async()=>globalThis.__workflowRegression.link;',
  '@/lib/documents': `export const acceptQuote=(...args)=>globalThis.__workflowRegression.accept(...args);
    export const ensureShareLink=async()=>({url:'/share/contract'});
    export const issueDepositInvoice=async()=>null;`,
  '@/lib/signing': 'export class SigningError extends Error{}; export const signDocument=async()=>({});',
  '@/lib/observability': 'export const reportError=()=>{};',
  '@/lib/billing': `export const refreshJobStatus=async()=>{};
    export const jobSettlement=async()=>({unbilledCents:500,agreedCents:1000,billedCents:500,contractId:'contract'});
    export const unbilledStage=async()=>({id:'phase',name:'Final'});`,
  '../share-links': 'export const ensureShareLink=async()=>({url:"/share/replacement"});',
  './create-invoice': 'export const createInvoice=(...args)=>globalThis.__workflowRegression.create(...args);',
  '@/lib/ledger': 'import {sql} from "drizzle-orm"; export const collectedForInvoice=()=>sql`0`;',
};
const bundle = await build({
  stdin: { contents: `
    export {quoteReviewHash} from './lib/signing/quote-review';
    export {approveFromLink} from './lib/share/approve';
    export {signQuoteFromLink} from './lib/share/sign-quote';
    export {voidInvoice} from './lib/documents/operations/void-invoice';
    export {issueDepositInvoice} from './lib/documents/operations/issue-deposit';
    export {issueFinalInvoice} from './lib/documents/operations/issue-final';
  `, resolveDir: process.cwd() },
  platform: 'node', format: 'cjs', bundle: true, packages: 'external', write: false,
  plugins: [{ name: 'workflow-boundaries', setup(b) {
    b.onResolve({ filter: /.*/ }, args => Object.hasOwn(stubs, args.path) ? { path: args.path, namespace: 'stub' } : undefined);
    b.onLoad({ filter: /.*/, namespace: 'stub' }, args => ({ contents: stubs[args.path], loader: 'js', resolveDir: process.cwd() }));
  } }],
});
const compiledModule = { exports: {} };
new Function('module', 'exports', 'require', bundle.outputFiles[0].text)(compiledModule, compiledModule.exports, require);
const { quoteReviewHash, approveFromLink, signQuoteFromLink, voidInvoice, issueDepositInvoice, issueFinalInvoice } = compiledModule.exports;
try {
  const hash = quoteReviewHash(fixture);
  for (const mutate of [
    q => { q.scope[0].sellPriceCents++; },
    q => { q.scope[0].description = 'Different work'; },
    q => { q.scope[0].phaseKey = 'b'; },
    q => { q.details.depositPercent++; },
    q => { q.details.drawPattern[0].percent = 50; },
    q => { q.details.validUntil = '2030-01-01'; },
    q => { q.termsText = 'Different terms'; },
  ]) {
    state.quote = structuredClone(fixture); mutate(state.quote);
    assert.notEqual(quoteReviewHash(state.quote), hash);
    for (const action of [() => approveFromLink('token', hash), () => signQuoteFromLink('token', { hash }, {})]) {
      reset([[{ status: 'sent' }]]);
      await assert.rejects(action, /quote has changed/i);
      assert.deepEqual(creations, [], 'Stale review cannot generate a contract');
    }
  }
  state.quote = { ...structuredClone(fixture), status: 'viewed', updatedAt: new Date() };
  assert.equal(quoteReviewHash(state.quote), hash, 'Recording a view does not invalidate acceptance');
  reset([[{ status: 'viewed' }]]);
  assert.deepEqual(await approveFromLink('token', hash), { next: '/share/contract' });
  assert.deepEqual(creations, ['contract']);
  for (const action of [() => approveFromLink('token'), () => signQuoteFromLink('token', {}, {})]) {
    reset([[{ status: 'sent' }]]);
    await assert.rejects(action, /quote has changed/i);
  }
  console.log('PASS quote price/scope/phase/deposit/terms/expiry changes reject both approval paths; current review succeeds; missing token fails closed');

  const owner = [{ jobId: 'job' }];
  const unpaid = { type: 'invoice', status: 'sent', paidCents: '0', voidedAt: null };
  reset([owner, [], [], [unpaid], [{ id: 'proof', jobId: 'job', invoiceId: 'old', drawScheduleId: 'phase', completedAt: new Date() }],
    [{ id: 'new-proof' }], [{ id: 'photo', fileUrl: 'proof.jpg', caption: 'Complete', position: 0 }], []]);
  assert.equal((await voidInvoice({ organizationId: 'org', invoiceId: 'old' })).outcome, 'voided');
  assert.deepEqual(calls.filter(c => c.lock).map(c => [c.table, c.lock]), [['jobs', 'update'], ['documents', 'update']]);
  assert.equal(calls.find(c => c.table === 'draw_schedule' && c.action === 'update').values.invoiceId, null);
  assert.equal(calls.find(c => c.table === 'evidence' && c.action === 'insert').values.invoiceId, null);
  assert.equal(calls.find(c => c.table === 'evidence_photos' && c.action === 'insert').values[0].evidenceId, 'new-proof');
  assert.ok(!calls.some(c => c.table === 'evidence' && c.action === 'update'), 'Original proof stays with withdrawn invoice');
  assert.equal(rows.length, 0);
  reset([owner, [], [], [{ ...unpaid, status: 'void', voidedAt: new Date() }]]);
  await voidInvoice({ organizationId: 'org', invoiceId: 'old' });
  assert.ok(!calls.some(c => c.action === 'insert'), 'Retry does not duplicate evidence');
  for (const paid of [{ ...unpaid, paidCents: '1' }, { ...unpaid, status: 'paid' }]) {
    reset([owner, [], [], [paid]]);
    await assert.rejects(() => voidInvoice({ organizationId: 'org', invoiceId: 'old' }), /money against it/);
    assert.ok(!calls.some(c => c.action === 'update' || c.action === 'insert'));
  }
  console.log('PASS void releases phase, preserves original proof/photos, prepares replacement proof, is idempotent, and refuses paid invoices');

  function assertLiveInvoiceFilter() {
    const lookup = calls.find(c => c.where?.sql.includes('invoice_type'));
    assert.ok(lookup.where.sql.includes('"status" <>'));
    assert.ok(lookup.where.params.includes('void'));
    assert.ok(lookup.where.sql.includes('"voided_at" is null'));
    assert.ok(calls.findIndex(c => c.table === 'jobs' && c.lock === 'update') < calls.indexOf(lookup));
  }
  const signed = [{ id: 'contract', jobId: 'job', status: 'signed', depositCents: 500 }];
  reset([signed, [], []]);
  assert.equal((await issueDepositInvoice({ organizationId: 'org', contractId: 'contract' })).invoiceId, 'replacement');
  assertLiveInvoiceFilter(); assert.equal(creations[0].type, 'deposit');
  reset([signed, [], [{ id: 'existing' }]]);
  assert.equal((await issueDepositInvoice({ organizationId: 'org', contractId: 'contract' })).invoiceId, 'existing');
  assert.equal(creations.length, 0);
  reset([[], []]);
  assert.equal((await issueFinalInvoice({ organizationId: 'org', jobId: 'job' })).invoiceId, 'replacement');
  assertLiveInvoiceFilter(); assert.equal(creations[0].type, 'final_balance');
  assert.equal(creations[0].amountDueCents, 500);
  reset([[], [{ number: 'INV1' }]]);
  await assert.rejects(() => issueFinalInvoice({ organizationId: 'org', jobId: 'job' }), /already the final bill/);
  assert.equal(creations.length, 0);
  console.log('PASS deposit/final issuance excludes voided bills under job lock, creates replacements, and prevents live duplicates');
} finally { delete globalThis.__workflowRegression; }
