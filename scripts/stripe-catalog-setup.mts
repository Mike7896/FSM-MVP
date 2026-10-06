import type Stripe from 'stripe';
import { membershipFixtures } from './stripe-fixtures.mjs';
import { PRODUCTS } from '../lib/membership/catalog';

/** Read everything before writing; refuse repricing and unrelated fixed IDs. */
export async function catalogPlan(client: Stripe) {
  const actions: { label: string; apply: () => Promise<unknown> }[] = [];
  for (const fixture of membershipFixtures()) {
    if (fixture.path === '/v1/products') {
      const params = fixture.params as unknown as Stripe.ProductCreateParams;
      let existing: Stripe.Product | undefined;
      try { existing = await client.products.retrieve(params.id!); }
      catch (error) { if ((error as {code?:string}).code !== 'resource_missing') throw error; }
      if (existing) {
        if (existing.metadata.app !== 'serviceclerk' || !existing.active) throw new Error(`Review existing product ${params.id}: not an active ServiceClerk product.`);
        continue;
      }
      actions.push({label:`Create product ${params.id}`,apply:()=>client.products.create(params,{idempotencyKey:`serviceclerk:catalog:v1:${params.id}`})});
    } else if (fixture.path === '/v1/prices') {
      const params = {...fixture.params} as unknown as Stripe.PriceCreateParams;
      const match = String(params.product).match(/^\$\{product_(.+):id\}$/);
      if (!match || !(match[1] in PRODUCTS)) throw new Error('Unknown fixture product reference');
      params.product = PRODUCTS[match[1] as keyof typeof PRODUCTS].id;
      // Never move an existing lookup key onto a newly priced live object.
      delete params.transfer_lookup_key;
      const existing=(await client.prices.list({lookup_keys:[params.lookup_key!],limit:100})).data;
      if(existing.length>1)throw new Error(`Multiple prices for ${params.lookup_key}`);
      if(existing[0]) {
        const p=existing[0];
        const product=typeof p.product==='string'?p.product:p.product.id;
        const metadata=params.metadata ?? {};
        if(!p.active || product!==params.product || p.currency!==params.currency || p.unit_amount!==params.unit_amount || p.tax_behavior!==params.tax_behavior || (p.recurring?.interval ?? null)!==(params.recurring?.interval ?? null) || (p.recurring?.interval_count ?? null)!==(params.recurring?.interval_count ?? null) || Object.entries(metadata).some(([k,v])=>p.metadata[k]!==v)) {
          throw new Error(`Existing price ${params.lookup_key} differs from the catalog. Review it manually; no repricing performed.`);
        }
        continue;
      }
      actions.push({label:`Create price ${params.lookup_key}: ${params.unit_amount} cents ${params.recurring?.interval ?? 'one-time'}`,apply:()=>client.prices.create(params,{idempotencyKey:`serviceclerk:catalog:v1:${params.lookup_key}`})});
    } else {
      const params=fixture.params as unknown as Stripe.BillingPortal.ConfigurationCreateParams;
      const matches: Stripe.BillingPortal.Configuration[]=[];
      for await(const row of client.billingPortal.configurations.list({limit:100,active:true})) {
        if(row.metadata?.app==='serviceclerk' && row.metadata?.portal==='membership_v1')matches.push(row);
      }
      if(matches.length>1)throw new Error('Multiple active ServiceClerk membership portals; review before setup.');
      if(matches[0]) {
        const portal=matches[0];
        // Existing portal is left unchanged when already configured correctly.
        const f=portal.features;
        const allowed=[...(f.customer_update.allowed_updates ?? [])].sort();
        const expected=[...(params.features.customer_update?.allowed_updates ?? [])].sort();
        if(f.subscription_update.enabled || !f.subscription_cancel.enabled || f.subscription_cancel.mode!=='at_period_end' || f.subscription_cancel.proration_behavior!=='none' || !f.invoice_history.enabled || !f.payment_method_update.enabled || !f.customer_update.enabled || JSON.stringify(allowed)!==JSON.stringify(expected)) {
          actions.push({label:`Update ServiceClerk portal ${portal.id}`,apply:()=>client.billingPortal.configurations.update(portal.id,params)});
        }
      } else {
        actions.push({label:'Create ServiceClerk membership portal',apply:()=>client.billingPortal.configurations.create(params,{idempotencyKey:'serviceclerk:catalog:v1:portal'})});
      }
    }
  }
  return actions;
}
