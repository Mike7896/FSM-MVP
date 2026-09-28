-- New contractor payment accounts get Stripe's full Dashboard (Billing §8.1).
-- The column is written from Stripe's own answer on every sync; this only keeps
-- the default in step with the code for a row inserted without it.
ALTER TABLE "connected_accounts" ALTER COLUMN "dashboard_type" SET DEFAULT 'full';
