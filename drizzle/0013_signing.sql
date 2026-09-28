CREATE TYPE "public"."signature_auth_method" AS ENUM('account', 'share_link');--> statement-breakpoint
CREATE TYPE "public"."signature_kind" AS ENUM('drawn', 'typed');--> statement-breakpoint
ALTER TABLE "document_signatures" ADD COLUMN "signature_kind" "signature_kind" DEFAULT 'typed' NOT NULL;--> statement-breakpoint
ALTER TABLE "document_signatures" ADD COLUMN "consented_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "document_signatures" ADD COLUMN "document_hash" text;--> statement-breakpoint
ALTER TABLE "document_signatures" ADD COLUMN "signer_email" text;--> statement-breakpoint
ALTER TABLE "document_signatures" ADD COLUMN "auth_method" "signature_auth_method" DEFAULT 'account' NOT NULL;