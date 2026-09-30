-- What each membership brings in a month — core plan, packs and recurring
-- discounts — written on every reconcile so the admin dashboard's MRR is what
-- Stripe actually bills, not the core plan's list price. Rerunnable.
ALTER TABLE public.billing_accounts ADD COLUMN IF NOT EXISTS mrr_cents integer;
