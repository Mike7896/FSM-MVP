CREATE TABLE IF NOT EXISTS public.platform_usage (
  id text PRIMARY KEY,
  configuration jsonb NOT NULL,
  updated_by uuid NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
ALTER TABLE public.platform_usage ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
REVOKE ALL ON public.platform_usage FROM anon, authenticated;
-- Access is exclusively through the server's admin-authorized routes.
