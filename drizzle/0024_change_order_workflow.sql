ALTER TABLE change_order_details ADD COLUMN tax_rate numeric(8,6);
ALTER TABLE change_order_details ADD COLUMN billing_mode text NOT NULL DEFAULT 'next_draw';
ALTER TABLE change_order_details ADD COLUMN base_amount_cents bigint;
ALTER TABLE change_order_details ADD CONSTRAINT change_order_billing_mode_check CHECK (billing_mode IN ('next_draw', 'supplemental'));
--> statement-breakpoint
CREATE TABLE change_requests (
  id uuid PRIMARY KEY,
  contract_id uuid NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  body text NOT NULL DEFAULT '',
  photo_paths jsonb NOT NULL DEFAULT '[]',
  upload_count integer NOT NULL DEFAULT 0,
  submitted_at timestamptz,
  change_order_id uuid REFERENCES documents(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX change_requests_contract_idx ON change_requests(contract_id);
ALTER TABLE change_requests ENABLE ROW LEVEL SECURITY;
CREATE POLICY "change_requests: members read" ON change_requests FOR SELECT TO authenticated USING (EXISTS (SELECT 1 FROM documents d WHERE d.id = contract_id AND public.is_org_member(d.organization_id)));
--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.change_order_details_freeze_guard()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE frozen timestamptz;
BEGIN
  SELECT frozen_at INTO frozen FROM documents WHERE id = OLD.document_id;
  IF frozen IS NOT NULL THEN
    IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'Approved change orders cannot be deleted.'; END IF;
    IF (to_jsonb(NEW) - 'approved_at') IS DISTINCT FROM (to_jsonb(OLD) - 'approved_at') THEN
      RAISE EXCEPTION 'Approved change orders cannot be edited.';
    END IF;
  END IF;
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END $$;
