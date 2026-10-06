/** Synthetic signed HTTP events: real local route and DB, no provider delivery or charge. */
import assert from 'node:assert/strict';
import { randomUUID, createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { writeFile } from 'node:fs/promises';
import Stripe from 'stripe';
import { sql } from 'drizzle-orm';
const require = createRequire(import.meta.url);
assert.match(process.env.STRIPE_SECRET_KEY ?? '', /^(sk|rk)_test_/);
// Fail closed if parallel infrastructure setup changes the audited database.
assert.equal(createHash('sha256').update(process.env.DATABASE_URL ?? '').digest('hex').slice(0, 12), 'ee69d089c0cf');
const { db } = require('@/lib/db') as typeof import('@/lib/db');
const client = new Stripe(process.env.STRIPE_SECRET_KEY!);
const secret = process.env.LAUNCH_LOCAL_CONNECT_SECRET;
assert.ok(secret, 'Use the process-only signing secret configured on the local audit server');
const results: {name:string;status:string}[] = [];
const orgs: string[] = [];
const events: string[] = [];
function check(name:string, ok=true) { assert.ok(ok,name);results.push({name,status:'passed'});console.log(`PASS ${name}`); }
async function fixture() {
  const [org] = await db.execute<{id:string}>(sql`insert into organizations(name,slug) values ('Connect transport audit',${`connect-transport-audit-${randomUUID()}`}) returning id`);
  orgs.push(org.id);
  const [customer] = await db.execute<{id:string}>(sql`insert into customers(organization_id,name) values (${org.id},'Disposable customer') returning id`);
  const [job] = await db.execute<{id:string}>(sql`insert into jobs(organization_id,customer_id,name) values (${org.id},${customer.id},'Disposable job') returning id`);
  const [invoice] = await db.execute<{id:string}>(sql`insert into documents(organization_id,job_id,customer_id,type,status) values (${org.id},${job.id},${customer.id},'invoice','draft') returning id`);
  await db.execute(sql`insert into invoice_details(document_id,invoice_type,amount_due_cents) values (${invoice.id},'deposit',10000)`);
  await db.execute(sql`update documents set status='sent' where id=${invoice.id}`);
  return {org:org.id,job:job.id,invoice:invoice.id};
}
try {
  const own = await fixture();
  const other = await fixture();
  const account = `acct_audit_${randomUUID()}`;
  await db.execute(sql`insert into connected_accounts(organization_id,stripe_account_id,charges_enabled) values (${own.org},${account},true)`);
  const charge = {id:`ch_audit_${randomUUID()}`,object:'charge',amount:10000,currency:'usd',created:Math.floor(Date.now()/1000),paid:true,status:'succeeded',balance_transaction:null,application_fee_amount:0,payment_method_details:{type:'card'},metadata:{invoiceId:own.invoice,jobId:own.job}};
  function event(object:unknown, type='charge.succeeded', connectedAccount=account) {
    const id=`evt_audit_${randomUUID()}`;events.push(id);
    return {id,object:'event',type,account:connectedAccount,livemode:false,data:{object}};
  }
  const initial = event(charge);
  async function deliver(value:unknown, signingSecret:string|undefined=secret, age=0, tamper=false) {
    const payload=JSON.stringify(value);
    const headers:Record<string,string>={};
    if(signingSecret) headers['stripe-signature']=client.webhooks.generateTestHeaderString({payload,secret:signingSecret,timestamp:Math.floor(Date.now()/1000)-age});
    return fetch('http://localhost:3105/api/stripe/connect/webhook',{method:'POST',headers,body:payload+(tamper?' ':'')});
  }
  check('Connect rejects unsigned event',(await deliver(initial,'')).status===400);
  check('Connect rejects wrong signing secret',(await deliver(initial,'whsec_wrong')).status===400);
  check('Connect rejects stale signature',(await deliver(initial,secret,600)).status===400);
  check('Connect rejects tampered raw bytes',(await deliver(initial,secret,0,true)).status===400);
  check('Connect accepts signed charge event',(await deliver(initial)).status===200);
  check('Repeated event acknowledged as duplicate',(await (await deliver(initial)).json()).duplicate===true);
  check('Distinct event for same charge accepted',(await deliver(event(charge))).status===200);
  const [posted]=await db.execute<{count:string;amount:string}>(sql`select count(*)::text as count,sum(amount_cents)::text as amount from ledger_entries where organization_id=${own.org} and invoice_id=${own.invoice}`);
  check('Repeated charge posts one payment only',posted.count==='1' && posted.amount==='10000');
  const foreignCharge={...charge,id:`ch_audit_${randomUUID()}`,metadata:{invoiceId:other.invoice,jobId:other.job}};
  check('Foreign invoice metadata event handled',(await deliver(event(foreignCharge))).status===200);
  const foreignRows=await db.execute<{organization_id:string;invoice_id:string|null;job_id:string|null}>(sql`select organization_id,invoice_id,job_id from ledger_entries where external_ref=${foreignCharge.id}`);
  check('Foreign metadata cannot post to another tenant',foreignRows.length===1 && foreignRows[0].organization_id===own.org && foreignRows[0].invoice_id===null && foreignRows[0].job_id===null);
  check('Unknown Connect account acknowledged',(await deliver(event({...charge,id:`ch_audit_${randomUUID()}`},'charge.succeeded',`acct_unknown_${randomUUID()}`))).status===200);
  const [untouched]=await db.execute<{count:string}>(sql`select count(*)::text as count from ledger_entries where organization_id=${other.org}`);
  check('Other tenant ledger remains untouched',untouched.count==='0');
} finally {
  for(const id of events) await db.execute(sql`delete from stripe_events where id=${id}`);
  for(const id of orgs) await db.transaction(async tx=>{
    await tx.execute(sql`set local session_replication_role=replica`);
    await tx.execute(sql`delete from ledger_entries where organization_id=${id}`);
    await tx.execute(sql`delete from invoice_details where document_id in (select id from documents where organization_id=${id})`);
    await tx.execute(sql`delete from documents where organization_id=${id}`);
    await tx.execute(sql`set local session_replication_role=origin`);
    await tx.execute(sql`delete from organizations where id=${id}`);
  });
  await writeFile('docs/launch-connect-webhook-results.json',JSON.stringify(results,null,2));
  await globalThis.__fsmDbPool?.end({timeout:2});
}
