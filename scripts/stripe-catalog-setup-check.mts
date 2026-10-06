/** Offline production-catalog regression: never loads environment credentials. */
import assert from 'node:assert/strict';
import type Stripe from 'stripe';
import { catalogPlan } from './stripe-catalog-setup.mjs';
import { membershipFixtures } from './stripe-fixtures.mjs';

const products=new Map<string,Record<string,unknown>>();
const prices=new Map<string,Record<string,unknown>>();
const portals:Record<string,unknown>[]=[];
let writes=0;
const fake={
  products:{retrieve:async(id:string)=>{const p=products.get(id);if(!p)throw Object.assign(new Error('missing'),{code:'resource_missing'});return p;},create:async(p:Record<string,unknown>)=>{writes++;products.set(p.id as string,{...p,active:true});return p;}},
  prices:{list:async(p:{lookup_keys:string[]})=>({data:[...prices.values()].filter(x=>p.lookup_keys.includes(x.lookup_key as string))}),create:async(p:Record<string,unknown>)=>{writes++;assert.equal(p.transfer_lookup_key,undefined);prices.set(p.lookup_key as string,{...p,active:true,id:`price_${writes}`});return p;}},
  billingPortal:{configurations:{list:()=>({async *[Symbol.asyncIterator](){yield* portals;}}),create:async(p:Record<string,unknown>)=>{writes++;const value={...p,id:'bpc_check'};portals.push(value);return value;},update:async(id:string,p:Record<string,unknown>)=>{writes++;Object.assign(portals.find(x=>x.id===id)!,p);return p;}}},
} as unknown as Stripe;
const plan=await catalogPlan(fake);
assert.equal(writes,0);assert.equal(plan.length,membershipFixtures().length);
console.log('PASS Preview plans missing catalog without writing');
for(const action of plan)await action.apply();
assert.equal((await catalogPlan(fake)).length,0);
console.log('PASS Applied catalog is a no-op on retry');
const first=[...prices.values()][0];
const prior=first.unit_amount;first.unit_amount=1;
const before=writes;
await assert.rejects(()=>catalogPlan(fake),/differs/);assert.equal(writes,before);first.unit_amount=prior;
console.log('PASS Existing mismatched price fails without repricing');
const product=[...products.values()][0];const metadata=product.metadata;product.metadata={app:'another-app'};
await assert.rejects(()=>catalogPlan(fake),/Review existing product/);product.metadata=metadata;
console.log('PASS Unrelated product using reserved ID is rejected');
const features=portals[0].features as {subscription_update:{enabled:boolean}};
features.subscription_update.enabled=true;
const repair=await catalogPlan(fake);assert.equal(repair.length,1);await repair[0].apply();
assert.equal((await catalogPlan(fake)).length,0);
console.log('PASS Portal correction restores guarded membership behavior');
portals.push({...portals[0],id:'bpc_duplicate'});
await assert.rejects(()=>catalogPlan(fake),/Multiple active/);
console.log('PASS Ambiguous membership portals are rejected');
