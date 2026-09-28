ALTER TABLE "quote_details" ADD COLUMN "signature_lines" boolean DEFAULT true NOT NULL;
--> statement-breakpoint
-- The freeze guard lists every column that must not move once a quote is
-- accepted. Whether it carried signature lines is part of what was agreed, so
-- it joins the list.
create or replace function public.quote_details_freeze_guard()
returns trigger language plpgsql as $$
declare
  frozen timestamptz;
  doc    text;
begin
  select d.frozen_at, d.number into frozen, doc
    from public.documents d
   where d.id = coalesce(OLD.document_id, NEW.document_id);

  if frozen is null then
    return case when TG_OP = 'DELETE' then OLD else NEW end;
  end if;

  if TG_OP = 'DELETE' then
    raise exception 'Document % is frozen; its details cannot be deleted.', doc;
  end if;

  if (
      NEW.document_id,
      NEW.valid_until,
      NEW.estimating_method,
      NEW.estimate_class,
      NEW.pricing_method,
      NEW.price_structure,
      NEW.contract_type,
      NEW.cap_cents,
      NEW.billing_trigger,
      NEW.money_up_front,
      NEW.deposit_percent,
      NEW.progress_billing,
      NEW.retainage_percent,
      NEW.tax_rate,
      NEW.commitment_summary,
      NEW.license_id,
      NEW.selected_option_id,
      NEW.signature_lines
    ) is distinct from (
      OLD.document_id,
      OLD.valid_until,
      OLD.estimating_method,
      OLD.estimate_class,
      OLD.pricing_method,
      OLD.price_structure,
      OLD.contract_type,
      OLD.cap_cents,
      OLD.billing_trigger,
      OLD.money_up_front,
      OLD.deposit_percent,
      OLD.progress_billing,
      OLD.retainage_percent,
      OLD.tax_rate,
      OLD.commitment_summary,
      OLD.license_id,
      OLD.selected_option_id,
      OLD.signature_lines
    )
  then
    raise exception 'Document % is frozen; % cannot be edited.', doc, 'quote_details';
  end if;

  return NEW;
end $$;
