import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile, writeFile, unlink } from "node:fs/promises";
import { createClient } from "@supabase/supabase-js";
import { createServerClient } from "@supabase/ssr";
import { sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { signDocument } from "@/lib/signing/sign";
import { cleanupChangeOrderFixture } from "./cleanup-change-order-fixture";

const base = 'http://127.0.0.1:3000';
const fixturePath = '.next/co-browser.json';
const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SECRET_KEY!, { auth: { persistSession: false, autoRefreshToken: false } });
if (process.argv.includes('--cleanup')) {
  const fixture = JSON.parse(await readFile(fixturePath, 'utf8'));
  await cleanupChangeOrderFixture(fixture.orgId);
  await admin.auth.admin.deleteUser(fixture.userId);
  await unlink(fixturePath);
  await globalThis.__fsmDbPool?.end();
  console.log('Browser fixture and test user removed.');
  process.exit(0);
}
const cookies = new Map<string, string>();
const auth = createServerClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!, { cookies: { getAll: () => [...cookies].map(([name,value]) => ({ name,value })), setAll: values => values.forEach(c => cookies.set(c.name,c.value)) } });
let orgId: string | undefined, userId: string | undefined, token = '', keep = false;
let passed = 0;
function check(label: string, condition = true) { assert.ok(condition,label); console.log(`ok ${++passed}: ${label}`); }
async function api(path: string, method: string, body: unknown, status = 200, authenticated = true) {
  const res = await fetch(`${base}${path}`, { method, headers: { 'Content-Type':'application/json', ...(authenticated ? { Authorization: `Bearer ${token}`, 'X-Organization-Id':orgId! } : {}) }, ...(body === undefined ? {} : { body:JSON.stringify(body) }) });
  const data = await res.json(); assert.equal(res.status,status,JSON.stringify(data)); return data.data;
}
try {
  const email = `co-check-${randomUUID()}@example.invalid`, password = `Test-${randomUUID()}!`;
  const created = await admin.auth.admin.createUser({ email,password,email_confirm:true }); if (created.error) throw created.error;
  userId = created.data.user.id;
  const session = await auth.auth.signInWithPassword({email,password}); if (session.error) throw session.error; token = session.data.session.access_token;
  const [org] = await db.execute<{id:string}>(sql`insert into organizations (name,slug) values ('Change Order UI Check',${`co-check-${randomUUID()}`}) returning id`); orgId = org.id;
  await db.execute(sql`insert into memberships (organization_id,user_id,role) values (${orgId},${userId},'owner')`);
  const [customer] = await db.execute<{id:string}>(sql`insert into customers (organization_id,name) values (${orgId},'Temporary customer') returning id`);
  const [job] = await db.execute<{id:string}>(sql`insert into jobs (organization_id,customer_id,name) values (${orgId},${customer.id},'Temporary change-order job') returning id`);
  const [parent] = await db.execute<{id:string}>(sql`insert into documents (organization_id,job_id,customer_id,type,status,title) values (${orgId},${job.id},${customer.id},'contract','generated','Original work') returning id`);
  await db.execute(sql`insert into contract_details (document_id,contract_sum_cents) values (${parent.id},100000)`);
  await db.execute(sql`insert into scope_nodes (organization_id,document_id,node_type,section,description,quantity,sell_price_cents) values (${orgId},${parent.id},'item','labor','Original scope',1,100000)`);
  for (const party of ['contractor','customer'] as const) await signDocument({documentId:parent.id,organizationId:orgId,party,printedName:party,mark:{kind:'typed'},consented:true,authMethod:'account'});
  const id=randomUUID();
  const input = {parentContractId:parent.id,title:'Add outlet',summary:'Add an outlet beside the workbench.',scope:[{id:null,parentIndex:null,nodeType:'item',section:'labor',description:'Outlet installation',quantity:1,unit:null,unitCostCents:null,markupBps:null,sellPriceCents:15000,taxable:false,optional:false,position:0,source:'typed'}],timeImpactDays:1,billingMode:'next_draw'};
  const draft = await api(`/api/v1/change-orders/${id}`,'PUT',input); check('authenticated create endpoint persists change');
  await api(`/api/v1/change-orders/${id}`,'GET',undefined,401,false); check('private draft requires authentication');
  await api(`/api/v1/change-orders/${id}`,'PUT',{...input,revision:'stale'},409); check('stale editor revision returns conflict');
  for (const path of [`/jobs/${job.id}/change-orders/new`,`/jobs/${job.id}/change-orders/${id}`,`/jobs/${job.id}/change-orders`]) {
    const res = await fetch(`${base}${path}`,{headers:{Cookie:[...cookies].map(([k,v])=>`${k}=${v}`).join('; ')}}); const html=await res.text(); check(`render ${path}`,res.ok && !html.includes('NEXT_HTTP_ERROR_FALLBACK;500'));
  }
  const sent=await api(`/api/v1/change-orders/${id}/send`,'POST',{revision:draft.revision,printedName:'Test Contractor',consented:true});
  const shared=await fetch(`${base}/share/${sent.token}`); const html=await shared.text(); check('customer page shows change and approval',shared.ok&&html.includes('Sign &amp; approve change')&&html.includes('Outlet installation'));
  const newDraftId=randomUUID(); await api(`/api/v1/change-orders/${newDraftId}`,'PUT',input);
  if (process.argv.includes('--keep')) {
    await writeFile(fixturePath,JSON.stringify({orgId,userId,email,password,jobId:job.id,draftId:newDraftId,sentId:id,token:sent.token},null,2));keep=true;console.log(`Browser fixture ready in ${fixturePath}`);
  }
  console.log(`${passed} HTTP checks passed.`);
} finally {
  if (!keep) { if(orgId) await cleanupChangeOrderFixture(orgId); if(userId) await admin.auth.admin.deleteUser(userId); }
  await globalThis.__fsmDbPool?.end();
}
