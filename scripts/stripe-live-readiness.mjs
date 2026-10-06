/** Read-only live audit. The two synthetic POSTs use ignored event types and
 * cannot invoke billing handlers. No customers, charges or settings are created. */
import {readFileSync,writeFileSync} from 'node:fs';
import {parse} from 'dotenv';
import Stripe from 'stripe';
import postgres from 'postgres';
const env=parse(readFileSync('.env.production'));
if(!/^(sk|rk)_live_/.test(env.STRIPE_SECRET_KEY ?? ''))throw new Error('Live configuration required');
const base=new URL(env.NEXT_PUBLIC_SITE_URL).origin;
if(!base.startsWith('https://'))throw new Error('HTTPS required');
const stripe=new Stripe(env.STRIPE_SECRET_KEY,{apiVersion:'2026-07-29.dahlia'});
const db=postgres(env.DATABASE_URL,{prepare:false,max:1});
const results=[];
function result(name,data){results.push({name,...data});console.log(name,JSON.stringify(data));}
async function run(name,fn){try{result(name,await fn());}catch(e){result(name,{status:'failed',code:e.code ?? e.name,message:String(e.message).replace(/(?:sk|rk|pk)_(?:live|test)_[A-Za-z0-9]+/g,'[redacted]')});}}
try {
  await run('Platform readiness',async()=>{const a=await stripe.accounts.retrieveCurrent();return {chargesEnabled:a.charges_enabled,payoutsEnabled:a.payouts_enabled,detailsSubmitted:a.details_submitted,capabilities:a.capabilities,requirementsDue:a.requirements?.currently_due,requirementsPending:a.requirements?.pending_verification,disabledReason:a.requirements?.disabled_reason};});
  await run('Database catalog matches live Stripe',async()=>{
    const rows=await db`select id,lookup_key,unit_amount,currency,active from prices`;
    let matched=0;const mismatches=[];
    for(const r of rows){try{const p=await stripe.prices.retrieve(r.id);if(p.livemode && p.lookup_key===r.lookup_key && p.unit_amount===r.unit_amount && p.currency===r.currency && p.active===r.active)matched++;else mismatches.push(r.lookup_key);}catch{mismatches.push(r.lookup_key);}}
    const duplicates=await db`select lookup_key,count(*)::int as count from prices where active and lookup_key is not null group by lookup_key having count(*)>1`;
    return {rows:rows.length,matched,mismatches,duplicateActiveKeys:duplicates};
  });
  await run('Customer and subscription mappings',async()=>{
    const customers=await db`select stripe_customer_id as id from stripe_customers`;
    const subs=await db`select id from subscriptions union select subscription_id as id from billing_accounts where subscription_id is not null`;
    let invalidCustomers=0,invalidSubscriptions=0;
    for(const row of customers){try{const c=await stripe.customers.retrieve(row.id);if(c.deleted||!c.livemode)invalidCustomers++;}catch{invalidCustomers++;}}
    for(const row of subs){try{const s=await stripe.subscriptions.retrieve(row.id);if(!s.livemode)invalidSubscriptions++;}catch{invalidSubscriptions++;}}
    return {customers:customers.length,subscriptions:subs.length,invalidCustomers,invalidSubscriptions};
  });
  await run('Connected-account readiness',async()=>{
    const rows=await db`select stripe_account_id,charges_enabled,payouts_enabled from connected_accounts`;
    const accounts=[];
    for(const row of rows){try{const a=await stripe.accounts.retrieve(row.stripe_account_id);accounts.push({validLiveReference:true,card:a.capabilities?.card_payments,ach:a.capabilities?.us_bank_account_ach_payments,chargesEnabled:a.charges_enabled,payoutsEnabled:a.payouts_enabled,requirementsDue:a.requirements?.currently_due,requirementsPending:a.requirements?.pending_verification,disabledReason:a.requirements?.disabled_reason,projectionMatches:row.charges_enabled===a.charges_enabled&&row.payouts_enabled===a.payouts_enabled});}catch(e){accounts.push({validLiveReference:false,error:e.code});}}
    return {mappedAccounts:rows.length,accounts};
  });
  await run('Release switches',async()=>({rows:await db`select key,enabled from billing_releases`}));
  await run('Live webhooks',async()=>{
    const endpoints=await stripe.webhookEndpoints.list({limit:100});
    const membership=readFileSync('lib/membership/webhook.ts','utf8').split('export const MEMBERSHIP_EVENTS')[1].split(']);')[0];
    const catalog=readFileSync('app/api/stripe/webhook/route.ts','utf8').split('const CATALOG_EVENTS')[1].split(']);')[0];
    const connect=readFileSync('app/api/stripe/connect/webhook/route.ts','utf8').split('const RELEVANT_EVENTS')[1].split(']);')[0];
    const names=s=>[...s.matchAll(/"([a-z_]+\.[a-z_.]+)"/g)].map(m=>m[1]);
    return {endpoints:endpoints.data.map(e=>({url:e.url,enabled:e.status==='enabled',apiVersion:e.api_version,missingEvents:(e.url.endsWith('/connect/webhook')?names(connect):names(membership+catalog)).filter(n=>!e.enabled_events.includes('*')&&!e.enabled_events.includes(n))}))};
  });
  await run('Recent actual event processing',async()=>{
    const events=await stripe.events.list({limit:100});let matched=0;let relevant=0;
    for(const e of events.data){if(!['product.created','product.updated','price.created','price.updated','customer.subscription.created','customer.subscription.updated','invoice.paid','charge.succeeded','account.updated'].includes(e.type))continue;relevant++;const row=await db`select id from stripe_events where id=${e.id}`;if(row.length)matched++;}
    return {sampled:events.data.length,relevant,storedReceipts:matched,eventsWithPendingWebhooks:events.data.filter(e=>e.pending_webhooks>0).length};
  });
  await run('Stripe Tax configuration',async()=>{const settings=await stripe.tax.settings.retrieve();return {status:settings.status,missingFields:settings.status_details?.pending?.missing_fields,activeRegistrationCount:(await stripe.tax.registrations.list({status:'active',limit:100})).data.length};});
  await run('Deployed Google auth production target',async()=>{
    const response=await fetch(base+'/auth/google',{method:'POST',redirect:'manual',headers:{Origin:base,'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({next:'/welcome?plan=starter&interval=year'})});
    const location=response.headers.get('location');
    if(!location)return {httpStatus:response.status,redirectPresent:false};
    const target=new URL(location,base);
    const callback=target.searchParams.get('redirect_to');
    const matchesProduction=target.origin===new URL(env.NEXT_PUBLIC_SUPABASE_URL).origin;
    let providerRedirectHost=null;
    if(matchesProduction){const provider=await fetch(target,{redirect:'manual'});const next=provider.headers.get('location');if(next)providerRedirectHost=new URL(next,target).hostname;}
    return {httpStatus:response.status,targetHost:target.hostname,matchesProduction,callbackMatchesProduction:callback?new URL(callback).origin===base:false,providerRedirectHost};
  });
  for(const [path,key] of [['/api/stripe/webhook','STRIPE_WEBHOOK_SECRET'],['/api/stripe/connect/webhook','STRIPE_CONNECT_WEBHOOK_SECRET']])await run(`Deployed signature check ${path}`,async()=>{
    if(!env[key])return {status:'missing local signing secret'};
    const payload=JSON.stringify({id:'evt_readiness_ignored',object:'event',livemode:true,type:'audit.readiness_ignored',data:{object:{}}});
    const response=await fetch(base+path,{method:'POST',redirect:'manual',headers:{'stripe-signature':stripe.webhooks.generateTestHeaderString({payload,secret:env[key]})},body:payload});
    const body=await response.json().catch(()=>({}));
    return {httpStatus:response.status,verifiedIgnoredEvent:body.ignored==='audit.readiness_ignored'};
  });
  for(const path of ['/','/pricing','/signup','/login','/legal/privacy','/legal/terms','/account/billing','/api/cron/accounts'])await run(`Deployed GET ${path}`,async()=>{
    const r=await fetch(base+path,{redirect:'manual'});return {status:r.status,redirect:r.headers.get('location')};
  });
}finally{await db.end();writeFileSync('docs/stripe-live-readiness-results.json',JSON.stringify({checkedAt:new Date().toISOString(),base,results},null,2));}
