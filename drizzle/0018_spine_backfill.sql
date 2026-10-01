-- ---------------------------------------------------------------------------
-- Moving the documents onto the spine — Documents §12, item 14.
--
-- The editor, the share page and every money surface read `quotes` and
-- `line_items`; the contract, signing and freeze machinery was built on
-- `documents` and `scope_nodes`, and no quote ever reached it. This moves what
-- exists across so both halves are one system, and the next migration drops the
-- old tables.
--
-- **Ids are kept.** A quote's id becomes its document's id and a line's id
-- becomes its node's id, so a URL, a share link or a permit fee pointing at one
-- still points at the same thing afterwards.
--
-- **It only moves quotes**, because quotes are all that exist before cut-over.
-- Anything else on the old tables is refused rather than silently left behind
-- to be dropped with them.
-- ---------------------------------------------------------------------------
do $$
begin
  if exists (select 1 from public.contracts)
     or exists (select 1 from public.change_orders)
     or exists (select 1 from public.invoices)
     or exists (select 1 from public.options)
     or exists (select 1 from public.line_items where change_order_id is not null)
     or exists (
       select 1 from public.share_links
        where contract_id is not null
           or change_order_id is not null
           or invoice_id is not null
     )
     or exists (select 1 from public.permits where fee_line_item_id is not null)
  then
    raise exception
      'The old document tables hold contracts, change orders, invoices, options '
      'or links to them. This backfill moves quotes only — extend it before '
      'running it here.';
  end if;
end $$;
--> statement-breakpoint

-- The quote itself. An accepted quote is written one step short of accepted and
-- moved there at the end: the freeze would otherwise refuse its scope nodes.
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
  -- The old counter was already per shop, so the numbers carry across as-is.
  case when q.number > 0 then 'Q-' || lpad(q.number::text, 4, '0') else '' end,
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
join public.jobs j on j.id = q.job_id;
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
from public.quotes q;
--> statement-breakpoint

-- The Scope tree, whole, in one statement: referential integrity is checked at
-- the end of it, so a parent and its children land together.
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
  -- Percent to basis points: 35.000 becomes 3500.
  case when li.markup_percent is null then null
       else round(li.markup_percent * 100)::int end,
  li.sell_price_cents,
  li.taxable,
  coalesce(li.pack_detail, '{}'::jsonb),
  li.source,
  li.created_at
from public.line_items li
join public.quotes q on q.id = li.quote_id
join public.jobs j on j.id = q.job_id;
--> statement-breakpoint

-- Now that its scope is in, an accepted quote becomes accepted — and the freeze
-- trigger stamps it, exactly as it would have on the day.
update public.documents d
   set status = 'accepted'
  from public.quotes q
 where q.id = d.id
   and q.status = 'approved';
--> statement-breakpoint

-- What went out, and how. The old table kept only the last send.
insert into public.document_sends (
  organization_id, document_id, channel, recipient, sent_at
)
select d.organization_id, d.id, coalesce(q.sent_channel, 'link'), q.sent_to, q.sent_at
from public.quotes q
join public.documents d on d.id = q.id
where q.sent_at is not null;
--> statement-breakpoint

update public.share_links
   set document_id = quote_id
 where quote_id is not null;
--> statement-breakpoint

-- Same posture as every other org-scoped table: Drizzle bypasses this, so the
-- DAL and `requireOrg` stay the real authorization.
alter table public.document_sends enable row level security;
--> statement-breakpoint
create policy "document_sends: org members full access"
  on public.document_sends for all to authenticated
  using (public.is_org_member(organization_id))
  with check (public.is_org_member(organization_id));
