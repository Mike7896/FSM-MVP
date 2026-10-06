/** Explicit production-only setup. Default is read-only; never reads .env.local. */
import { readFileSync } from 'node:fs';
import { parse } from 'dotenv';
import Stripe from 'stripe';
import { catalogPlan } from './stripe-catalog-setup.mjs';

async function main() {
  const args=process.argv.slice(2);
  if(args.includes('--help')) {
    console.log('Preview: npm run stripe:catalog:production\nApply: npm run stripe:catalog:production -- --apply --account acct_...\nMirror: npm run stripe:catalog:production -- --sync --account acct_... --project-ref YOUR_REF');
    return;
  }
  const options=new Map<string,string>();
  for(let i=0;i<args.length;i++) {
    const flag=args[i];
    if(!['--apply','--sync','--account','--project-ref'].includes(flag) || options.has(flag))throw new Error(`Unknown or repeated argument: ${flag}`);
    if(flag==='--apply'||flag==='--sync')options.set(flag,'true');
    else {const value=args[++i];if(!value || value.startsWith('--'))throw new Error(`Missing value for ${flag}`);options.set(flag,value);}
  }
  if(options.has('--apply')&&options.has('--sync'))throw new Error('Apply and sync are separate steps.');
  const env=parse(readFileSync('.env.production'));
  const key=env.STRIPE_SECRET_KEY ?? '';
  if(!/^(sk|rk)_live_/.test(key))throw new Error('.env.production must contain a live Stripe secret key.');
  if(!env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY?.startsWith('pk_live_'))throw new Error('.env.production must contain a live publishable key.');
  const site=new URL(env.NEXT_PUBLIC_SITE_URL ?? '');
  if(site.protocol!=='https:' || site.hostname==='localhost')throw new Error('Production site URL must use HTTPS.');
  const client=new Stripe(key,{apiVersion:'2026-07-29.dahlia',maxNetworkRetries:2});
  const account=await client.accounts.retrieveCurrent();
  console.log(`Live Stripe account: ${account.id} (${account.business_profile?.name ?? account.settings?.dashboard?.display_name ?? 'unnamed'})`);
  console.log(`Site: ${site.origin}. Credentials read exclusively from .env.production.`);
  if((options.has('--apply')||options.has('--sync')) && options.get('--account')!==account.id)throw new Error('Pass --account with the account ID printed by the read-only preview.');
  if(options.has('--sync')) {
    const ref=options.get('--project-ref');
    if(!ref || !/^[a-z0-9]+$/.test(ref))throw new Error('--project-ref is required for database synchronization.');
    const supabase=new URL(env.NEXT_PUBLIC_SUPABASE_URL ?? '');
    const database=new URL(env.DATABASE_URL ?? '');
    if(supabase.hostname!==`${ref}.supabase.co` || !(database.hostname===`db.${ref}.supabase.co` || (database.hostname.endsWith('.pooler.supabase.com') && decodeURIComponent(database.username)===`postgres.${ref}`)))throw new Error('Production Supabase URL/database do not both match --project-ref.');
    console.log(`Production Supabase project: ${ref}`);
    // Do not let an inherited dev credential fill a missing production value.
    for(const name of ['DATABASE_URL','NEXT_PUBLIC_SUPABASE_URL','NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY','SUPABASE_SECRET_KEY'])if(!env[name])throw new Error(`Missing ${name} in .env.production`);
    Object.assign(process.env,env);
    const {db}=await import('../lib/db');
    const {sql}=await import('drizzle-orm');
    try {
      // No deletion/reset: stop if this database still points at sandbox objects.
      const prices=await db.execute<{id:string}>(sql`select id from prices`);
      for(const row of prices) {const price=await client.prices.retrieve(row.id);if(!price.livemode)throw new Error('Non-live catalog row found');}
      const customers=await db.execute<{id:string}>(sql`select stripe_customer_id as id from stripe_customers`);
      for(const row of customers) {const customer=await client.customers.retrieve(row.id);if(customer.deleted || !customer.livemode)throw new Error('Invalid live customer mapping');}
      const accounts=await db.execute<{id:string}>(sql`select stripe_account_id as id from connected_accounts`);
      for(const row of accounts)await client.accounts.retrieve(row.id);
      const subscriptions=await db.execute<{id:string}>(sql`select subscription_id as id from billing_accounts where subscription_id is not null union select id from subscriptions`);
      for(const row of subscriptions)await client.subscriptions.retrieve(row.id);
      const {syncCatalog}=await import('../lib/stripe/sync');
      const result=await syncCatalog();
      console.log(`Mirrored ${result.products} live products and ${result.prices} live prices. No customer or connected account was created.`);
    } finally {await globalThis.__fsmDbPool?.end({timeout:2});}
    return;
  }
  const plan=await catalogPlan(client);
  for(const step of plan)console.log(step.label);
  if(!options.has('--apply')) {console.log(`Read-only preview: ${plan.length} actions. No writes made. Run again with --apply --account ${account.id} to apply.`);return;}
  for(const step of plan) {await step.apply();console.log(`Done: ${step.label}`);}
  const remaining=await catalogPlan(client);
  if(remaining.length)throw new Error('Post-apply verification found remaining catalog changes. Rerun the read-only preview.');
  console.log('Live catalog verified. Next: --sync --account with this account ID and --project-ref with the production Supabase ref.');
}
main().catch(error=>{console.error(error instanceof Error?error.message:'Production setup failed');process.exitCode=1;});
