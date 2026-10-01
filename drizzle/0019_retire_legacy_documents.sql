-- ---------------------------------------------------------------------------
-- Retiring the old document tables — Documents §12, item 14.
--
-- 0018 copied every quote onto the spine. Anything written to the old tables
-- between that migration and the code moving over is copied here by the same
-- rules — only where it isn't on the spine already — before the tables go.
-- Anything it can't move is refused rather than dropped with them.
-- ---------------------------------------------------------------------------
do $$
begin
  if exists (select 1 from public.contracts)
     or exists (select 1 from public.change_orders)
     or exists (select 1 from public.invoices)
     or exists (select 1 from public.options)
     or exists (select 1 from public.line_items where change_order_id is not null)
  then
    raise exception
      'The old document tables hold contracts, change orders, invoices or '
      'options. Move them onto the spine before dropping the tables.';
  end if;
end $$;
--> statement-breakpoint

insert into public.documents (
  id, organization_id, job_id, customer_id, type, number, status,
  title, summary, terms_text, pack_id, sent_at, viewed_at,
  created_by, created_at, updated_at
)
select
  q.id,
  j.organization_id,
  q.job_id,
  j.customer_id,
  'quote',
  -- The old number where it's still free on the spine; otherwise the spine's
  -- own counter assigns one.
  case
    when q.number > 0 and not exists (
      select 1 from public.documents taken
       where taken.organization_id = j.organization_id
         and taken.type = 'quote'
         and taken.number = 'Q-' || lpad(q.number::text, 4, '0')
    ) then 'Q-' || lpad(q.number::text, 4, '0')
    else ''
  end,
  (case q.status::text when 'approved' then 'viewed' else q.status::text end)::public.document_status,
  q.title,
  q.scope_of_work,
  q.terms,
  q.pack_id,
  q.sent_at,
  q.viewed_at,
  q.created_by,
  q.created_at,
  q.updated_at
from public.quotes q
join public.jobs j on j.id = q.job_id
where not exists (select 1 from public.documents d where d.id = q.id);
--> statement-breakpoint

insert into public.quote_details (
  document_id, valid_until, estimating_method, estimate_class, pricing_method,
  price_structure, contract_type, cap_cents, billing_trigger, money_up_front,
  deposit_percent, progress_billing, retainage_percent, tax_rate,
  commitment_summary, license_id
)
select
  q.id, q.valid_until, q.estimating_method, q.estimate_class, q.pricing_method,
  q.price_structure, q.contract_type, q.cap_cents, q.billing_trigger,
  q.money_up_front, q.deposit_percent, q.progress_billing, q.retainage_percent,
  q.tax_rate, q.commitment_summary, q.license_id
from public.quotes q
where not exists (
  select 1 from public.quote_details qd where qd.document_id = q.id
);
--> statement-breakpoint

insert into public.scope_nodes (
  id, organization_id, document_id, parent_node_id, position, node_type,
  section, optional, description, quantity, unit, unit_cost_cents, markup_bps,
  sell_price_cents, taxable, details, source, created_at
)
select
  li.id,
  j.organization_id,
  li.quote_id,
  li.parent_id,
  li.position,
  li.type,
  li.section,
  li.optional,
  li.description,
  li.quantity,
  li.unit,
  li.unit_cost_cents,
  case when li.markup_percent is null then null
       else round(li.markup_percent * 100)::int end,
  li.sell_price_cents,
  li.taxable,
  coalesce(li.pack_detail, '{}'::jsonb),
  li.source,
  li.created_at
from public.line_items li
join public.quotes q on q.id = li.quote_id
join public.jobs j on j.id = q.job_id
where not exists (select 1 from public.scope_nodes n where n.id = li.id);
--> statement-breakpoint

update public.documents d
   set status = 'accepted'
  from public.quotes q
 where q.id = d.id
   and q.status = 'approved'
   and d.status <> 'accepted';
--> statement-breakpoint

insert into public.document_sends (
  organization_id, document_id, channel, recipient, sent_at
)
select d.organization_id, d.id, coalesce(q.sent_channel, 'link'), q.sent_to, q.sent_at
from public.quotes q
join public.documents d on d.id = q.id
where q.sent_at is not null
  and not exists (
    select 1 from public.document_sends s where s.document_id = q.id
  );
--> statement-breakpoint

update public.share_links
   set document_id = quote_id
 where document_id is null
   and quote_id is not null;
--> statement-breakpoint

do $$
begin
  if exists (select 1 from public.share_links where document_id is null) then
    raise exception
      'A share link points at no document on the spine, so it cannot be kept.';
  end if;
end $$;
--> statement-breakpoint

-- The old per-table numbering goes with its tables. The spine numbers every
-- document through `set_document_number`.
drop function if exists public.set_quote_number() cascade;
--> statement-breakpoint
drop function if exists public.set_invoice_number() cascade;
--> statement-breakpoint
drop function if exists public.set_change_order_number() cascade;
--> statement-breakpoint

ALTER TABLE "change_orders" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "contracts" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "invoices" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "line_items" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "option_line_items" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "options" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "quotes" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
DROP TABLE "change_orders" CASCADE;--> statement-breakpoint
DROP TABLE "contracts" CASCADE;--> statement-breakpoint
DROP TABLE "invoices" CASCADE;--> statement-breakpoint
DROP TABLE "line_items" CASCADE;--> statement-breakpoint
DROP TABLE "option_line_items" CASCADE;--> statement-breakpoint
DROP TABLE "options" CASCADE;--> statement-breakpoint
DROP TABLE "quotes" CASCADE;--> statement-breakpoint
ALTER TABLE "permits" DROP CONSTRAINT IF EXISTS "permits_fee_line_item_id_line_items_id_fk";
--> statement-breakpoint
ALTER TABLE "share_links" DROP CONSTRAINT IF EXISTS "share_links_quote_id_quotes_id_fk";
--> statement-breakpoint
ALTER TABLE "share_links" DROP CONSTRAINT IF EXISTS "share_links_contract_id_contracts_id_fk";
--> statement-breakpoint
ALTER TABLE "share_links" DROP CONSTRAINT IF EXISTS "share_links_change_order_id_change_orders_id_fk";
--> statement-breakpoint
ALTER TABLE "share_links" DROP CONSTRAINT IF EXISTS "share_links_invoice_id_invoices_id_fk";
--> statement-breakpoint
ALTER TABLE "share_links" ALTER COLUMN "document_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "permits" DROP COLUMN "fee_line_item_id";--> statement-breakpoint
ALTER TABLE "share_links" DROP COLUMN "quote_id";--> statement-breakpoint
ALTER TABLE "share_links" DROP COLUMN "contract_id";--> statement-breakpoint
ALTER TABLE "share_links" DROP COLUMN "change_order_id";--> statement-breakpoint
ALTER TABLE "share_links" DROP COLUMN "invoice_id";--> statement-breakpoint
DROP TYPE "public"."change_order_status";--> statement-breakpoint
DROP TYPE "public"."invoice_status";--> statement-breakpoint
DROP TYPE "public"."quote_status";