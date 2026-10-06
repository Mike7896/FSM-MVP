/** Browser acceptance using disposable accounts. No customer emails or live charges. */
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { mkdir, writeFile } from 'node:fs/promises';
import { config } from 'dotenv';
import { createClient } from '@supabase/supabase-js';
import postgres from 'postgres';
import Stripe from 'stripe';
config({ path: '.env.local', quiet: true });
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_PACKAGE ?? 'C:/Users/Michel/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const base = process.env.AUDIT_BASE ?? 'http://localhost:3105';
assert.ok(new URL(base).hostname === 'localhost', 'This script is for the local audit server only');
assert.match(process.env.STRIPE_SECRET_KEY ?? '', /^(sk|rk)_test_/);
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
const sql = postgres(process.env.DATABASE_URL, { prepare: false, max: 1 });
const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SECRET_KEY, {auth:{persistSession:false,autoRefreshToken:false}});
const runId = randomUUID();
const email = `browser-audit-${runId}@example.invalid`;
const password = `Audit-${randomUUID()}!`;
const evidence = 'docs/launch-browser-fix-evidence';
await mkdir(evidence, {recursive:true});
const results = [];
const browser = await chromium.launch({channel:'msedge',headless:true});
let userId;
let orgId;
let auditPage;
const check = (name, value=true) => { assert.ok(value,name); results.push({name,status:'passed'}); console.log(`PASS ${name}`); };
try {
  const context = await browser.newContext({viewport:{width:1440,height:1000}});
  const page = await context.newPage();
  auditPage = page;
  page.setDefaultTimeout(45000);
  const browserErrors=[];
  page.on('pageerror',error=>browserErrors.push(error.message));
  await page.goto(`${base}/pricing`);
  await page.getByRole('tab',{name:'Annual · 2 months free',exact:true}).click();
  check('Annual pricing displays the full annual Starter bill',(await page.locator('body').innerText()).includes('$290'));
  await page.getByRole('button',{name:'Start with Starter',exact:true}).click();
  await page.waitForURL('**/signup?**');
  check('Pricing CTA preserves plan and interval',new URL(page.url()).searchParams.get('interval')==='year');
  const google = await page.locator('form[action="/auth/google"] input[name="next"]').inputValue();
  check('Google entry preserves purchase destination',google.includes('plan=starter') && google.includes('interval=year'));
  await page.getByRole('button',{name:'Create account',exact:true}).click();
  check('Signup validates an empty submission',(await page.locator('body').innerText()).includes('valid email'));
  await page.screenshot({path:`${evidence}/signup-desktop.png`,fullPage:true});

  const created=await admin.auth.admin.createUser({email,password,email_confirm:true,user_metadata:{full_name:'Launch Audit'}});
  if(created.error) throw created.error;
  userId=created.data.user.id;
  await page.getByRole('link',{name:'Sign in',exact:true}).click();
  await page.waitForURL('**/login?**');
  await page.waitForLoadState('networkidle');
  await page.getByLabel('Email',{exact:true}).fill(email);
  await page.getByLabel('Password',{exact:true}).fill(password);
  assert.equal(await page.getByLabel('Email',{exact:true}).inputValue(),email);
  await page.getByRole('button',{name:'Sign in',exact:true}).click();
  await page.waitForURL('**/welcome?**');
  await page.getByRole('button',{name:'Continue to my bill'}).click();
  await page.waitForURL('**/upgrade/checkout?**');
  const body=await page.locator('body').innerText();
  check('Login, welcome, Office creation, and selected annual checkout work',body.includes('Starter, billed yearly.') && body.includes('$290'));
  const [membership]=await sql`select organization_id from memberships where user_id=${userId}`;
  orgId=membership.organization_id;
  await sql`update organizations set name='Launch Audit Fixture' where id=${orgId}`;
  await sql`insert into licenses (organization_id,jurisdiction,number) values (${orgId},'Audit fixture','TEST-ONLY')`;
  await page.screenshot({path:`${evidence}/selected-checkout.png`,fullPage:true});
  // Real checkout creation is tested; do not submit payment in this baseline.
  const checkoutResponse=page.waitForResponse(r=>r.url().endsWith('/api/stripe/checkout') && r.request().method()==='POST');
  await page.getByRole('button',{name:'Continue to payment'}).click();
  const checkout=await checkoutResponse;
  if (!checkout.ok()) {
    const checkoutBody=await checkout.json();
    results.push({name:'Hosted subscription checkout',status:'failed',detail:checkoutBody.error?.message});
    console.log('FINDING hosted checkout:',checkoutBody.error?.message);
  } else {
    await page.waitForURL('https://checkout.stripe.com/**');
    await page.getByText('ServiceClerk Starter',{exact:false}).first().waitFor();
    check('Real sandbox hosted checkout opens with selected Starter plan');
    await page.screenshot({path:`${evidence}/stripe-checkout.png`,fullPage:true});
  }
  await page.goto(`${base}/office/library`);
  check('Free library renders an upgrade explanation',(await page.locator('body').innerText()).includes('Starter'));
  async function api(path,data) {
    const response=await context.request.post(`${base}${path}`,{data});
    const payload=await response.json();
    assert.ok(response.ok(),`${path}: ${JSON.stringify(payload)}`);
    return payload.data;
  }
  const scope=[{id:null,parentIndex:null,nodeType:'item',section:'labor',description:'Fixture installation',quantity:1,unit:null,unitCostCents:3500,markupBps:null,sellPriceCents:10000,taxable:false,optional:false,position:0,source:'typed'}];
  const quote=await api('/api/v1/quotes',{title:'Launch browser fixture',customerName:'Fixture Homeowner',scope});
  await page.goto(`${base}/quotes/${quote.id}/view`);
  await page.emulateMedia({media:'print'});
  await page.pdf({path:`${evidence}/unactivated-quote.pdf`,printBackground:true});
  const [activation]=await sql`select status from job_activations where job_id=${quote.jobId}`;
  check('Native print marks an unactivated quote as a draft',!activation && await page.locator('[data-print-unactivated="true"]').evaluate(el=>getComputedStyle(el,'::after').content.includes('DRAFT')));
  await page.emulateMedia({media:'screen'});
  await page.evaluate(()=>{window.print=()=>{window.__auditPrinted=true;};});
  await page.getByRole('button',{name:'Print or save as PDF',exact:true}).click();
  await page.waitForFunction(()=>window.__auditPrinted===true);
  const [printedActivation]=await sql`select status from job_activations where job_id=${quote.jobId}`;
  check('Print button activates once and removes the draft marker',printedActivation?.status==='committed' && await page.locator('[data-print-unactivated="true"]').count()===0);
  await page.reload();
  check('Activated quote remains clean after reload',await page.locator('[data-print-unactivated="true"]').count()===0);
  for(let i=0;i<2;i++) {
    const extra=await api('/api/v1/quotes',{title:`Allowance fixture ${i}`,customerName:'Fixture Homeowner',scope});
    await api(`/api/v1/jobs/${extra.jobId}/activation`,{action:'pdf'});
  }
  const fourth=await api('/api/v1/quotes',{title:'Fourth unactivated quote',customerName:'Fixture Homeowner',scope});
  await page.goto(`${base}/quotes/${fourth.id}/view`);
  const refused=page.waitForResponse(response=>response.url().includes(`/jobs/${fourth.jobId}/activation`));
  await page.getByRole('button',{name:'Print or save as PDF',exact:true}).click();
  check('Fourth Free job cannot activate through Print',!(await refused).ok());
  await page.emulateMedia({media:'print'});
  await page.pdf({path:`${evidence}/exhausted-allowance-quote.pdf`,printBackground:true});
  check('Native print remains draft after allowance rejection',await page.locator('[data-print-unactivated="true"]').evaluate(el=>getComputedStyle(el,'::after').content.includes('DRAFT')));
  const [fourthActivation]=await sql`select status from job_activations where job_id=${fourth.jobId}`;
  check('Rejected fourth print does not consume an activation',fourthActivation?.status!=='committed');
  await page.emulateMedia({media:'screen'});
  const sent=await api(`/api/v1/quotes/${quote.id}/send`,{channel:'link'});
  const homeowner=await browser.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true});
  const share=await homeowner.newPage();
  const link=new URL(sent.url);
  const shareResponse=await share.goto(`${base}${link.pathname}`);
  check('Homeowner quote opens without a session',shareResponse.ok());
  const shareText=await share.locator('body').innerText();
  check('Homeowner sees quoted amount and no internal unit cost',shareText.includes('$100')&&!shareText.includes('$35'));
  const deliveredHtml=await shareResponse.text();
  check('Quote HTML does not serialize the internal unit cost',!/(?:unitCostCents|unitCost)[\\"\s:]+3500/.test(deliveredHtml));
  check('Homeowner mobile layout has no horizontal overflow',await share.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth));
  await share.screenshot({path:`${evidence}/homeowner-quote-mobile.png`,fullPage:true});
  await share.getByRole('button',{name:'Approve this quote',exact:true}).last().click();
  await share.waitForLoadState('networkidle');
  const [approved]=await sql`select status from documents where id=${quote.id}`;
  check('Homeowner approval records acceptance',approved.status==='accepted');
  const invoice=await api('/api/v1/invoices',{jobId:quote.jobId,type:'deposit',amountDueCents:10000,covers:'Browser audit invoice',issue:true});
  const invoiceSent=await api(`/api/v1/invoices/${invoice.id}/send`,{channel:'link'});
  const invoicePath=new URL(invoiceSent.url).pathname;
  await share.goto(base+invoicePath);
  check('Anonymous homeowner invoice shows the outstanding balance',(await share.locator('body').innerText()).includes('$100'));
  await share.screenshot({path:`${evidence}/invoice-unpaid-mobile.png`,fullPage:true});
  await api('/api/v1/payments',{invoiceId:invoice.id,amountCents:10000,method:'cash',occurredOn:new Date().toISOString().slice(0,10),memo:'Disposable browser audit fixture'});
  await share.reload();
  check('Recorded payment updates the homeowner invoice to paid',/paid in full|nothing.*due|paid/i.test(await share.locator('body').innerText()));
  const details=await context.request.get(`${base}/api/v1/invoices/${invoice.id}`);
  const paidInvoice=(await details.json()).data;
  check('Invoice ledger shows zero outstanding after payment',paidInvoice.outstandingCents===0);
  await share.screenshot({path:`${evidence}/invoice-paid-mobile.png`,fullPage:true});
  await sql`update share_links set revoked_at=now() where document_id=${quote.id}`;
  await share.goto(`${base}${link.pathname}`);
  check('Revoked homeowner link stops exposing the quote',!(await share.locator('body').innerText()).includes('Fixture installation'));
  await homeowner.close();
  for(const path of ['/account/billing','/office/connections','/office/branding','/analytics']) {
    const response=await page.goto(base+path);
    check(`Authenticated page renders: ${path}`,response.status()<500);
  }
  const missing=await context.request.post(`${base}/api/v1/jobs/${quote.jobId}/captures`,{data:{kind:'photo',storagePath:`${orgId}/${quote.jobId}/never-uploaded.png`}});
  check('Missing-file capture completion is rejected',missing.status()===400 || missing.status()===422);
  await page.goto(`${base}/office/connections`);
  const connectStart=page.locator('a[href="/api/connections/stripe_connect/start"]');
  if(await connectStart.count()) {
    await connectStart.click();
    await page.waitForURL(url=>url.hostname!=='localhost');
    check('Connected-account setup opens Stripe hosted onboarding',new URL(page.url()).hostname.endsWith('stripe.com'));
    await page.waitForLoadState('domcontentloaded');
    await page.screenshot({path:`${evidence}/connect-onboarding.png`,fullPage:true});
    console.log('Stripe onboarding page:',(await page.locator('body').innerText()).slice(0,2500));
  } else results.push({name:'Connect setup CTA',status:'not-found'});
  check('No uncaught browser JavaScript errors',browserErrors.length===0);
} catch(error) {
  if(auditPage) {
    await auditPage.screenshot({path:`${evidence}/failure.png`,fullPage:true}).catch(()=>{});
    console.log('Browser stopped at:',new URL(auditPage.url()).hostname);
    console.log((await auditPage.locator('body').innerText().catch(()=>'' )).replaceAll(email,'[fixture email]').slice(0,4000));
  }
  throw error;
} finally {
  await browser.close();
  // Discover only this fixture owner's Office, even if a UI assertion failed.
  if(userId && !orgId) {const [row]=await sql`select organization_id from memberships where user_id=${userId}`;orgId=row?.organization_id;}
  if(orgId) {
    const connected=await sql`select stripe_account_id from connected_accounts where organization_id=${orgId}`;
    for(const row of connected) await stripe.accounts.del(row.stripe_account_id);
    const customers=await sql`select stripe_customer_id from stripe_customers where organization_id=${orgId}`;
    for(const row of customers) {
      const sessions=await stripe.checkout.sessions.list({customer:row.stripe_customer_id,limit:100});
      for(const session of sessions.data) if(session.status==='open') await stripe.checkout.sessions.expire(session.id);
      await stripe.customers.del(row.stripe_customer_id);
    }
    await sql.begin(async tx=>{
      await tx`set local session_replication_role=replica`;
      await tx`delete from share_link_views where share_link_id in(select id from share_links where document_id in(select id from documents where organization_id=${orgId}))`;
      await tx`delete from document_signatures where document_id in(select id from documents where organization_id=${orgId})`;
      await tx`delete from contract_details where document_id in(select id from documents where organization_id=${orgId})`;
      await tx`delete from invoice_details where document_id in(select id from documents where organization_id=${orgId})`;
      await tx`delete from ledger_entries where organization_id=${orgId}`;
      await tx`delete from share_links where document_id in (select id from documents where organization_id=${orgId})`;
      await tx`delete from document_sends where document_id in (select id from documents where organization_id=${orgId})`;
      await tx`delete from quote_details where document_id in (select id from documents where organization_id=${orgId})`;
      await tx`delete from scope_nodes where document_id in (select id from documents where organization_id=${orgId})`;
      await tx`delete from documents where organization_id=${orgId}`;
      await tx`set local session_replication_role=origin`;
      await tx`delete from organizations where id=${orgId}`;
    });
  }
  if(userId) {const removed=await admin.auth.admin.deleteUser(userId);if(removed.error) throw removed.error;}
  await sql.end();
  await writeFile(`${evidence}/results.json`,JSON.stringify(results,null,2));
}
