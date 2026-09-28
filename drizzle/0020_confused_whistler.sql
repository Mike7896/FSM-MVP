CREATE TABLE "info_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"document_id" uuid NOT NULL,
	"questions" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"photo_prompt" text,
	"note" text,
	"answers" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"photo_paths" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"upload_count" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"answered_at" timestamp with time zone,
	"email_sent_at" timestamp with time zone,
	"recipient" text
);
--> statement-breakpoint
ALTER TABLE "info_requests" ADD CONSTRAINT "info_requests_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE public.info_requests ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "info_requests: read through document" ON public.info_requests
FOR SELECT TO authenticated USING (EXISTS (
  SELECT 1 FROM public.documents d WHERE d.id = document_id AND public.is_org_member(d.organization_id)
));
-- Writes use the authenticated application API or the validated share-token API.
