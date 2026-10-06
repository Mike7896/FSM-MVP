/** Regression checks for storage existence and complete, demo-free aging. */
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {createRequire} from 'node:module';
import {writeFile} from 'node:fs/promises';
import {sql} from 'drizzle-orm';
const require=createRequire(import.meta.url);
const {db}=require('@/lib/db') as typeof import('@/lib/db');
const {agingBalances}=require('@/lib/queries/analytics') as typeof import('@/lib/queries/analytics');
const {assertStoredFileWithinLimit}=require('@/lib/membership/storage') as typeof import('@/lib/membership/storage');
const {getReleases}=require('@/lib/membership/releases') as typeof import('@/lib/membership/releases');
const results:unknown[]=[];
let orgId:string|undefined;
try {
  const [org]=await db.execute<{id:string}>(sql`insert into organizations(name,slug) values ('Remaining audit fixture',${`remaining-audit-${randomUUID()}`}) returning id`);
  orgId=org.id;
  const [customer]=await db.execute<{id:string}>(sql`insert into customers(organization_id,name) values (${org.id},'Fixture') returning id`);
  const [job]=await db.execute<{id:string}>(sql`insert into jobs(organization_id,customer_id,name) values (${org.id},${customer.id},'Fixture') returning id`);
  let missingAccepted=true;
  try {await assertStoredFileWithinLimit(`${org.id}/${job.id}/missing-${randomUUID()}.png`);}catch{missingAccepted=false;}
  results.push({name:'Missing storage object accepted by completion size check',status:missingAccepted?'confirmed-audit-finding':'passed'});
  assert.equal(missingAccepted,false,'A nonexistent storage object must be rejected');
  console.log(`Missing storage object accepted: ${missingAccepted}`);
  await db.execute(sql`with inserted as (
    insert into documents(organization_id,job_id,customer_id,type,status)
    select ${org.id}::uuid,${job.id}::uuid,${customer.id}::uuid,'invoice','draft' from generate_series(1,1001)
    returning id)
    insert into invoice_details(document_id,invoice_type,amount_due_cents,due_on)
    select id,'deposit',10000,current_date-10 from inserted`);
  await db.execute(sql`update documents set status='sent',sent_at=now() where organization_id=${org.id}`);
  const aging=await agingBalances(org.id);
  const count=aging.reduce((n,bucket)=>n+bucket.count,0);
  const cents=aging.reduce((n,bucket)=>n+bucket.cents,0);
  assert.equal(count,1001,'All invoices must contribute to aging');
  assert.equal(cents,10010000);
  results.push({name:'Aging beyond 1000 invoices',status:'passed',expectedCount:1001,actualCount:count,expectedCents:10010000,actualCents:cents});
  console.log(`Aging: 1001 invoices created, ${count} counted; $${((10010000-cents)/100).toFixed(2)} omitted`);
  await db.execute(sql`update jobs set is_demo=true where id=${job.id}`);
  const demoCount=(await agingBalances(org.id)).reduce((n,b)=>n+b.count,0);
  assert.equal(demoCount,0,'Demo invoices must not contribute to aging');
  results.push({name:'Demo invoices in aging',status:demoCount?'confirmed-audit-finding':'passed',actualCount:demoCount});
  console.log(`Demo invoices counted in aging: ${demoCount}`);
  const [realJob]=await db.execute<{id:string}>(sql`insert into jobs(organization_id,customer_id,name) values (${org.id},${customer.id},'Aging boundaries') returning id`);
  async function addInvoice(days:number|null,status='sent',amount=10000) {
    const [doc]=await db.execute<{id:string}>(sql`insert into documents(organization_id,job_id,customer_id,type,status) values (${org.id},${realJob.id},${customer.id},'invoice','draft') returning id`);
    await db.execute(sql`insert into invoice_details(document_id,invoice_type,amount_due_cents,due_on) values (${doc.id},'deposit',${amount},current_date-${days}::int)`);
    if(status!=='draft')await db.execute(sql`update documents set status=${status}::document_status where id=${doc.id}`);
    return doc.id;
  }
  for(const days of [null,-1,0,1,30,31,60,61,90,91])await addInvoice(days);
  await addInvoice(91,'draft');
  await addInvoice(91,'void');
  const partial=await addInvoice(1);
  const overpaid=await addInvoice(31);
  for(const [invoice,amount,type] of [[partial,6000,'payment_received'],[partial,-2000,'refund_issued'],[overpaid,15000,'payment_received']] as const) {
    await db.execute(sql`insert into ledger_entries(organization_id,job_id,invoice_id,entry_type,amount_cents,currency,source,occurred_at) values (${org.id},${realJob.id},${invoice},${type},${amount},'usd','manual',now())`);
  }
  const boundaries=await agingBalances(org.id);
  assert.deepEqual(boundaries.map(b=>[b.count,b.cents]),[[3,30000],[3,26000],[2,20000],[2,20000],[1,10000]]);
  results.push({name:'Aging date boundaries, null due dates, draft/void exclusion, partial refunds and overpayments',status:'passed'});
  console.log('PASS Aging boundaries and ledger adjustments');
  const releases=await getReleases();
  results.push({name:'Release state',pro:releases.pro,electrical:releases.pack_electrical,achFee:releases.ach_application_fee});
  console.log(`ACH fee switch enabled: ${releases.ach_application_fee}`);
} finally {
  if(orgId) await db.transaction(async tx=>{
    await tx.execute(sql`set local session_replication_role=replica`);
    await tx.execute(sql`delete from ledger_entries where organization_id=${orgId}`);
    await tx.execute(sql`delete from invoice_details where document_id in(select id from documents where organization_id=${orgId})`);
    await tx.execute(sql`delete from documents where organization_id=${orgId}`);
    await tx.execute(sql`set local session_replication_role=origin`);
    await tx.execute(sql`delete from organizations where id=${orgId}`);
  });
  await writeFile('docs/launch-remainder-fixed-results.json',JSON.stringify(results,null,2));
  await globalThis.__fsmDbPool?.end({timeout:2});
}
