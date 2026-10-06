/** Local signed webhook transport plus actual Stripe sandbox subscription. */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import { writeFile } from "node:fs/promises";
import Stripe from "stripe";
import { sql } from "drizzle-orm";
const require = createRequire(import.meta.url);
assert.match(process.env.STRIPE_SECRET_KEY ?? "", /^(sk|rk)_test_/);
const client = new Stripe(process.env.STRIPE_SECRET_KEY!);
const { db } = require("@/lib/db") as typeof import("@/lib/db");
const { currentBill } = require("@/lib/membership/bill") as typeof import("@/lib/membership/bill");
const { readAccess } = require("@/lib/membership/access") as typeof import("@/lib/membership/access");
const { reconcileSubscription } = require("@/lib/membership/reconcile") as typeof import("@/lib/membership/reconcile");
const { stripe: appStripe } = require("@/lib/stripe/server") as typeof import("@/lib/stripe/server");
const base = "http://localhost:3105";
const results: unknown[] = [];
const receipts: string[] = [];
let orgId: string | undefined;
let customerId: string | undefined;
let couponId: string | undefined;
const check=(name:string,value=true)=>{assert.ok(value,name);console.log(`PASS ${name}`);results.push({name,status:"passed"});};
try {
  const endpoints=await client.webhookEndpoints.list({limit:100});
  results.push({name:"Configured Stripe sandbox webhook endpoints",endpoints:endpoints.data.map(row=>({url:row.url,status:row.status,events:row.enabled_events,apiVersion:row.api_version}))});
  console.log(`Stripe sandbox has ${endpoints.data.length} configured webhook endpoints`);
  for(const [path,key] of [["/api/stripe/webhook","STRIPE_WEBHOOK_SECRET"],["/api/stripe/connect/webhook","STRIPE_CONNECT_WEBHOOK_SECRET"]]) {
    const secret=process.env[key];
    if(!secret) {
      const response=await fetch(base+path,{method:"POST",body:"{}"});
      results.push({name:`${path} signing configuration`,status:"blocked",detail:`${key} missing`,httpStatus:response.status});
      console.log(`CONFIGURATION GAP ${path}: signing secret absent; HTTP ${response.status}`);
      continue;
    }
    const payload=JSON.stringify({id:`evt_audit_${randomUUID()}`,object:"event",type:"audit.ignored",livemode:false,data:{object:{}}});
    const unsigned=await fetch(base+path,{method:"POST",body:payload});
    check(`${path} rejects unsigned requests`,unsigned.status===400);
    const stale=client.webhooks.generateTestHeaderString({payload,secret,timestamp:Math.floor(Date.now()/1000)-600});
    const staleResponse=await fetch(base+path,{method:"POST",headers:{"stripe-signature":stale},body:payload});
    check(`${path} rejects expired signatures`,staleResponse.status===400);
    const signature=client.webhooks.generateTestHeaderString({payload,secret});
    const signed=await fetch(base+path,{method:"POST",headers:{"stripe-signature":signature},body:payload});
    check(`${path} accepts a valid signature without a login`,signed.status===200);
    const tampered=await fetch(base+path,{method:"POST",headers:{"stripe-signature":signature},body:payload+" "});
    check(`${path} rejects changed raw bytes`,tampered.status===400);
  }
  const cron=await fetch(base+"/api/cron/accounts");
  check("Membership sweep refuses an unauthenticated trigger",[401,500].includes(cron.status));
  results.push({name:"Cron local configuration",secretConfigured:Boolean(process.env.CRON_SECRET),unauthorizedStatus:cron.status});
  const [org]=await db.execute<{id:string}>(sql`insert into organizations (name,slug) values ('Webhook audit fixture',${`webhook-audit-${randomUUID()}`}) returning id`);
  orgId=org.id;
  const customer=await client.customers.create({name:"Disposable launch webhook audit"});customerId=customer.id;
  const method=await client.paymentMethods.attach("pm_card_visa",{customer:customer.id});
  await client.customers.update(customer.id,{invoice_settings:{default_payment_method:method.id}});
  await db.execute(sql`insert into stripe_customers (organization_id,stripe_customer_id) values (${org.id},${customer.id})`);
  const coupon=await client.coupons.create({percent_off:50,duration:"forever",name:"Disposable launch audit"});couponId=coupon.id;
  const prices=await client.prices.list({lookup_keys:["core_starter_month_v1"],limit:1});
  const sub=await client.subscriptions.create({customer:customer.id,items:[{price:prices.data[0].id}],discounts:[{coupon:coupon.id}],metadata:{organizationId:org.id},payment_behavior:"error_if_incomplete"});
  const eventId=`evt_audit_${randomUUID()}`;receipts.push(eventId);
  const payload=JSON.stringify({id:eventId,object:"event",type:"customer.subscription.updated",livemode:false,data:{object:sub}});
  async function deliver(){return fetch(base+"/api/stripe/webhook",{method:"POST",headers:{"stripe-signature":client.webhooks.generateTestHeaderString({payload,secret:process.env.STRIPE_WEBHOOK_SECRET!})},body:payload});}
  const response=await deliver();
  check("Signed subscription event reconciles the real sandbox subscription",response.status===200);
  const again=await deliver();
  check("Duplicate event is acknowledged without repeating effects",(await again.json()).duplicate===true);
  const access=await readAccess(org.id);
  check("Paid sandbox subscription grants Starter",access.tier==='starter' && access.standing==='paid');
  const bill=await currentBill(access);
  const upcoming=await client.invoices.createPreview({subscription:sub.id});
  check('Billing estimate reflects actual discounted Stripe amount due',bill?.upcoming?.amountDueCents===upcoming.amount_due);
  results.push({name:"Discount billing display",status:"passed",displayedCents:bill?.upcoming?.amountDueCents,upcomingCents:upcoming.amount_due,discount:"50% ongoing"});
  await client.subscriptions.update(sub.id,{discounts:''});
  check('Removing discount updates next invoice estimate',(await currentBill(access))?.upcoming?.amountDueCents===2900);
  await client.customers.createBalanceTransaction(customer.id,{amount:-500,currency:'usd',description:'Disposable regression credit'});
  check('Customer credit reduces displayed amount due',(await currentBill(access))?.upcoming?.amountDueCents===2400);
  const originalPreview=appStripe().invoices.createPreview;
  appStripe().invoices.createPreview=(async()=>{throw new Error('Injected preview outage');}) as typeof originalPreview;
  try {
    const unavailable=await currentBill(access);
    check('Preview outage retains catalog subtotal without inventing an invoice amount',unavailable?.totalCents===2900 && unavailable.upcoming===null);
  } finally {appStripe().invoices.createPreview=originalPreview;}
  const rows=await db.execute<{count:string}>(sql`select count(*)::text as count from stripe_events where id=${eventId}`);
  check("Only one webhook receipt is stored",rows[0].count==='1');
  // Model two real retrieves whose responses arrive in reverse order. The
  // second sees the later Pro snapshot; the first still holds older Starter.
  const oldSnapshot=await client.subscriptions.retrieve(sub.id,{expand:['latest_invoice','schedule.phases.items.price','discounts.source.coupon']});
  const proPrices=await client.prices.list({lookup_keys:['core_pro_month_v1'],limit:1});
  const newSnapshot=structuredClone(oldSnapshot);
  newSnapshot.items.data[0].price=proPrices.data[0];
  const sdk=appStripe();
  const originalRetrieve=sdk.subscriptions.retrieve;
  let entered!:()=>void;
  let release!:()=>void;
  const firstEntered=new Promise<void>(resolve=>{entered=resolve;});
  const firstRelease=new Promise<void>(resolve=>{release=resolve;});
  let calls=0;
  sdk.subscriptions.retrieve=(async()=>{
    if(++calls===1){entered();await firstRelease;return oldSnapshot;}
    return newSnapshot;
  }) as typeof sdk.subscriptions.retrieve;
  try {
    const older=reconcileSubscription(sub.id);
    await firstEntered;
    await reconcileSubscription(sub.id);
    check('Later Pro snapshot was initially projected',(await readAccess(org.id)).tier==='pro');
    release();await older;
    const final=(await readAccess(org.id)).tier;
    check('Overlapping retrieves preserve the newer Pro projection',final==='pro');
    results.push({name:'Overlapping retrieve/projection',status:final==='pro'?'passed':'confirmed-audit-finding',expected:'pro',actual:final});
    console.log(`Reconciliation race: expected newer Pro, final projection is ${final}`);
  } finally {release();sdk.subscriptions.retrieve=originalRetrieve;}
} finally {
  if(customerId) await client.customers.del(customerId);
  if(couponId) await client.coupons.del(couponId);
  for(const id of receipts) await db.execute(sql`delete from stripe_events where id=${id}`);
  if(orgId) await db.execute(sql`delete from organizations where id=${orgId}`);
  await writeFile('docs/launch-webhook-fixed-results.json',JSON.stringify(results,null,2));
  await globalThis.__fsmDbPool?.end({timeout:2});
  await globalThis.__fsmOperationLocks?.end({timeout:2});
}
