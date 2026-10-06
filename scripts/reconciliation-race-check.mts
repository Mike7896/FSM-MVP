/** Real database/locks and sandbox subscription; controlled retrieve timing. */
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { randomUUID } from 'node:crypto';
import Stripe from 'stripe';
import { sql } from 'drizzle-orm';
const require=createRequire(import.meta.url);
assert.match(process.env.STRIPE_SECRET_KEY ?? '', /^(sk|rk)_test_/);
const client=new Stripe(process.env.STRIPE_SECRET_KEY!);
const {db}=require('@/lib/db') as typeof import('@/lib/db');
const {stripe}=require('@/lib/stripe/server') as typeof import('@/lib/stripe/server');
const {reconcileSubscription,reconcileFrom}=require('@/lib/membership/reconcile') as typeof import('@/lib/membership/reconcile');
const {readAccess}=require('@/lib/membership/access') as typeof import('@/lib/membership/access');
const {withOperationLock}=require('@/lib/db/operation-lock') as typeof import('@/lib/db/operation-lock');
const sdk=stripe();
const original=sdk.subscriptions.retrieve;
let orgId:string|undefined;
let customerId:string|undefined;
function deferred(){let resolve!:()=>void;const promise=new Promise<void>(r=>{resolve=r;});return {promise,resolve};}
function pass(name:string){console.log(`PASS ${name}`);}
try {
  const [org]=await db.execute<{id:string}>(sql`insert into organizations(name,slug) values ('Reconciliation regression',${`reconcile-check-${randomUUID()}`}) returning id`);orgId=org.id;
  const customer=await client.customers.create({name:'Disposable reconciliation regression'});customerId=customer.id;
  await db.execute(sql`insert into stripe_customers(organization_id,stripe_customer_id) values (${org.id},${customer.id})`);
  const starter=(await client.prices.list({lookup_keys:['core_starter_month_v1'],limit:1})).data[0];
  const pro=(await client.prices.list({lookup_keys:['core_pro_month_v1'],limit:1})).data[0];
  const subscription=await client.subscriptions.create({customer:customer.id,items:[{price:starter.id}],trial_period_days:7,metadata:{organizationId:org.id}});
  const older=await client.subscriptions.retrieve(subscription.id);
  const newer=structuredClone(older);newer.items.data[0].price=pro;
  let entered=deferred(),release=deferred(),calls=0;
  sdk.subscriptions.retrieve=(async()=>{if(++calls===1){entered.resolve();await release.promise;return older;}return newer;}) as typeof original;
  const delayed=reconcileSubscription(subscription.id);
  try {
    await entered.promise;
    await reconcileSubscription(subscription.id);
    assert.equal((await readAccess(org.id)).tier,'pro');
  } finally {release.resolve();await delayed;}
  assert.equal((await readAccess(org.id)).tier,'pro');
  pass('Delayed pre-lock snapshot cannot overwrite newer Pro projection');

  entered=deferred();release=deferred();calls=0;
  sdk.subscriptions.retrieve=(async()=>{if(++calls===2){entered.resolve();await release.promise;}return newer;}) as typeof original;
  const holding=reconcileSubscription(subscription.id);
  try {
    await entered.promise;
    await assert.rejects(()=>reconcileSubscription(subscription.id),/Another operation/);
    pass('Concurrent reconciliation is refused while authoritative retrieve holds the shop lock');
    await assert.rejects(()=>reconcileSubscription('sub_other_same_shop'),/Another operation/);
    pass('Different subscriptions for the same shop share the projection lock');
  } finally {release.resolve();await holding;}
  await reconcileSubscription(subscription.id);
  pass('Retry succeeds after the prior projection releases its lock');
  await reconcileFrom(older);
  assert.equal((await readAccess(org.id)).tier,'pro');
  pass('Direct payload caller cannot project a stale supplied snapshot');
  calls=0;
  sdk.subscriptions.retrieve=(async()=>{if(++calls===2)throw new Error('injected retrieve failure');return newer;}) as typeof original;
  await assert.rejects(()=>reconcileSubscription(subscription.id),/injected/);
  await reconcileSubscription(subscription.id);
  assert.equal((await readAccess(org.id)).tier,'pro');
  pass('Failure releases the lock and leaves retryable projection');
  await withOperationLock(org.id,26,async()=>{
    await reconcileSubscription(subscription.id);
    await reconcileSubscription(subscription.id);
  });
  pass('Plan-change lock can nest and repeat reconciliation without deadlock');
} finally {
  sdk.subscriptions.retrieve=original;
  if(customerId)await client.customers.del(customerId);
  if(orgId)await db.execute(sql`delete from organizations where id=${orgId}`);
  await globalThis.__fsmDbPool?.end({timeout:2});
  await globalThis.__fsmOperationLocks?.end({timeout:2});
}
