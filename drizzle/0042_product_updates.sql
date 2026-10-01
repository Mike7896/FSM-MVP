CREATE TABLE "product_releases" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"version" text NOT NULL,
	"title" text NOT NULL,
	"items" jsonb NOT NULL,
	"published_at" timestamp with time zone,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "product_releases_version_unique" UNIQUE("version")
);
--> statement-breakpoint
CREATE TABLE "support_replies" (
	"id" uuid PRIMARY KEY NOT NULL,
	"request_id" uuid NOT NULL,
	"admin_id" uuid,
	"recipient" text NOT NULL,
	"subject" text NOT NULL,
	"body" text NOT NULL,
	"reply_to" text NOT NULL,
	"provider_id" text,
	"sent_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "product_releases" ADD CONSTRAINT "product_releases_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "auth"."users"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "support_replies" ADD CONSTRAINT "support_replies_request_id_support_requests_id_fk" FOREIGN KEY ("request_id") REFERENCES "public"."support_requests"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "support_replies" ADD CONSTRAINT "support_replies_admin_id_users_id_fk" FOREIGN KEY ("admin_id") REFERENCES "auth"."users"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "support_replies_request_idx" ON "support_replies" USING btree ("request_id","created_at");
--> statement-breakpoint
ALTER TABLE public.product_releases ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE public.support_replies ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
REVOKE ALL ON public.product_releases, public.support_replies FROM anon, authenticated;
