ALTER TABLE "office_defaults" ADD COLUMN "signature_name" text;--> statement-breakpoint
ALTER TABLE "office_defaults" ADD COLUMN "signature_mark" text;--> statement-breakpoint
ALTER TABLE "office_defaults" ADD COLUMN "auto_sign_contracts" boolean DEFAULT true NOT NULL;