-- ---------------------------------------------------------------------------
-- Cast the signature-driven status to its enum.
--
-- `case when ... then 'signed' else 'part_signed' end` is typed `text`, and
-- `documents.status` is `document_status`, so the assignment failed at runtime
-- with 42804 — the first signature ever written would have errored. Postgres
-- infers a bare literal against the target column but will not infer through a
-- CASE, which is exactly the sort of thing that only shows up when the trigger
-- actually fires.
--
-- `create or replace` makes this forward-only: nothing is dropped, and a
-- database that never ran the broken version reaches the same place.
-- ---------------------------------------------------------------------------
create or replace function public.contract_status_from_signatures()
returns trigger language plpgsql as $$
declare
  doc_type public.document_type;
  signature_count int;
begin
  select d.type into doc_type from public.documents d where d.id = new.document_id;
  if doc_type is distinct from 'contract' then
    return new;
  end if;

  select count(*) into signature_count
    from public.document_signatures s where s.document_id = new.document_id;

  update public.documents
     set status = (
       case when signature_count >= 2 then 'signed' else 'part_signed' end
     )::public.document_status
   where id = new.document_id
     and frozen_at is null;

  return new;
end $$;
