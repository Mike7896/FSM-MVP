CREATE TABLE "document_sends" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"document_id" uuid NOT NULL,
	"channel" text NOT NULL,
	"recipient" text,
	"message" text,
	"sent_by" uuid,
	"sent_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "document_sends_channel" CHECK ("document_sends"."channel" in ('email', 'link', 'text'))
);
--> statement-breakpoint
ALTER TABLE "share_links" DROP CONSTRAINT "share_links_one_target";--> statement-breakpoint
ALTER TABLE "draw_schedule" DROP CONSTRAINT "draw_schedule_contract_id_contracts_id_fk";
--> statement-breakpoint
ALTER TABLE "draw_schedule" DROP CONSTRAINT "draw_schedule_invoice_id_invoices_id_fk";
--> statement-breakpoint
ALTER TABLE "evidence" DROP CONSTRAINT "evidence_invoice_id_invoices_id_fk";
--> statement-breakpoint
ALTER TABLE "ledger_entries" DROP CONSTRAINT "ledger_entries_invoice_id_invoices_id_fk";
--> statement-breakpoint
ALTER TABLE "permits" ADD COLUMN "fee_scope_node_id" uuid;--> statement-breakpoint
ALTER TABLE "share_links" ADD COLUMN "document_id" uuid;--> statement-breakpoint
ALTER TABLE "document_sends" ADD CONSTRAINT "document_sends_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_sends" ADD CONSTRAINT "document_sends_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_sends" ADD CONSTRAINT "document_sends_sent_by_users_id_fk" FOREIGN KEY ("sent_by") REFERENCES "auth"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "document_sends_document_idx" ON "document_sends" USING btree ("document_id","sent_at");--> statement-breakpoint
ALTER TABLE "draw_schedule" ADD CONSTRAINT "draw_schedule_contract_id_documents_id_fk" FOREIGN KEY ("contract_id") REFERENCES "public"."documents"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "draw_schedule" ADD CONSTRAINT "draw_schedule_invoice_id_documents_id_fk" FOREIGN KEY ("invoice_id") REFERENCES "public"."documents"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "permits" ADD CONSTRAINT "permits_fee_scope_node_id_scope_nodes_id_fk" FOREIGN KEY ("fee_scope_node_id") REFERENCES "public"."scope_nodes"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "evidence" ADD CONSTRAINT "evidence_invoice_id_documents_id_fk" FOREIGN KEY ("invoice_id") REFERENCES "public"."documents"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "share_links" ADD CONSTRAINT "share_links_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ledger_entries" ADD CONSTRAINT "ledger_entries_invoice_id_documents_id_fk" FOREIGN KEY ("invoice_id") REFERENCES "public"."documents"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "share_links_document_idx" ON "share_links" USING btree ("document_id");