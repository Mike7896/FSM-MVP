CREATE TYPE "public"."deposit_basis" AS ENUM('percent', 'flat', 'none');--> statement-breakpoint
CREATE TYPE "public"."document_status" AS ENUM('draft', 'sent', 'viewed', 'accepted', 'declined', 'expired', 'generated', 'part_signed', 'signed', 'approved', 'issued', 'paid', 'void');--> statement-breakpoint
CREATE TYPE "public"."document_type" AS ENUM('quote', 'contract', 'change_order', 'invoice');--> statement-breakpoint
CREATE TYPE "public"."scope_reference_kind" AS ENUM('supersedes', 'settles', 'deletes');--> statement-breakpoint
CREATE TYPE "public"."signature_party" AS ENUM('contractor', 'customer');--> statement-breakpoint
CREATE TABLE "change_order_details" (
	"document_id" uuid PRIMARY KEY NOT NULL,
	"parent_contract_id" uuid NOT NULL,
	"what_changed" text,
	"delta_cents" bigint DEFAULT 0 NOT NULL,
	"time_impact_days" integer,
	"approved_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "contract_details" (
	"document_id" uuid PRIMARY KEY NOT NULL,
	"contract_sum_cents" bigint DEFAULT 0 NOT NULL,
	"deposit_cents" bigint,
	"deposit_basis" "deposit_basis" DEFAULT 'none' NOT NULL,
	"contract_type" "contract_type",
	"billing_trigger" "billing_trigger",
	"money_up_front" "money_up_front",
	"deposit_percent" integer,
	"progress_billing" "progress_billing",
	"retainage_percent" integer,
	"license_id" uuid,
	"accepted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "document_options" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"document_id" uuid NOT NULL,
	"name" text NOT NULL,
	"summary" text,
	"position" integer DEFAULT 0 NOT NULL,
	"recommended" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE "document_signatures" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"document_id" uuid NOT NULL,
	"party" "signature_party" NOT NULL,
	"printed_name" text NOT NULL,
	"signature_data" text NOT NULL,
	"signed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"ip" text,
	"user_agent" text
);
--> statement-breakpoint
CREATE TABLE "documents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"job_id" uuid NOT NULL,
	"customer_id" uuid,
	"type" "document_type" NOT NULL,
	"number" text NOT NULL,
	"status" "document_status" NOT NULL,
	"source_document_id" uuid,
	"title" text,
	"summary" text,
	"terms_text" text,
	"header_snapshot" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"pack_id" text,
	"issued_at" timestamp with time zone,
	"sent_at" timestamp with time zone,
	"viewed_at" timestamp with time zone,
	"frozen_at" timestamp with time zone,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "documents_status_matches_type" CHECK (("documents"."type" = 'quote' and "documents"."status" in ('draft', 'sent', 'viewed', 'accepted', 'declined', 'expired')) or ("documents"."type" = 'contract' and "documents"."status" in ('generated', 'part_signed', 'signed')) or ("documents"."type" = 'change_order' and "documents"."status" in ('draft', 'sent', 'approved', 'declined')) or ("documents"."type" = 'invoice' and "documents"."status" in ('draft', 'issued', 'sent', 'viewed', 'paid', 'void')))
);
--> statement-breakpoint
CREATE TABLE "invoice_details" (
	"document_id" uuid PRIMARY KEY NOT NULL,
	"invoice_type" "invoice_type" NOT NULL,
	"amount_due_cents" bigint DEFAULT 0 NOT NULL,
	"due_on" date,
	"covers" text,
	"gate_met_at" timestamp with time zone,
	"voided_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "option_nodes" (
	"option_id" uuid NOT NULL,
	"node_id" uuid NOT NULL,
	CONSTRAINT "option_nodes_option_id_node_id_pk" PRIMARY KEY("option_id","node_id")
);
--> statement-breakpoint
CREATE TABLE "quote_details" (
	"document_id" uuid PRIMARY KEY NOT NULL,
	"valid_until" date,
	"estimating_method" "estimating_method",
	"estimate_class" "estimate_class",
	"pricing_method" "pricing_method",
	"price_structure" "price_structure",
	"contract_type" "contract_type",
	"cap_cents" bigint,
	"billing_trigger" "billing_trigger",
	"money_up_front" "money_up_front",
	"deposit_percent" integer,
	"progress_billing" "progress_billing",
	"retainage_percent" integer,
	"tax_rate" numeric(6, 4),
	"commitment_summary" text,
	"license_id" uuid,
	"selected_option_id" uuid
);
--> statement-breakpoint
CREATE TABLE "scope_nodes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"document_id" uuid NOT NULL,
	"parent_node_id" uuid,
	"position" integer DEFAULT 0 NOT NULL,
	"node_type" "line_item_type" DEFAULT 'item' NOT NULL,
	"section" "line_item_section",
	"optional" boolean DEFAULT false NOT NULL,
	"description" text NOT NULL,
	"quantity" numeric(12, 3) DEFAULT '1' NOT NULL,
	"unit" text,
	"unit_cost_cents" bigint,
	"markup_bps" integer,
	"sell_price_cents" bigint DEFAULT 0 NOT NULL,
	"taxable" boolean DEFAULT true NOT NULL,
	"details" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"source" "line_item_source" DEFAULT 'typed' NOT NULL,
	"copied_from_node_id" uuid,
	"references_node_id" uuid,
	"reference_kind" "scope_reference_kind",
	"allowance_settled_cents" bigint,
	"allowance_settled_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "scope_nodes_bucket_matches_type" CHECK (("scope_nodes"."node_type" in ('item', 'allowance')) = ("scope_nodes"."section" is not null)),
	CONSTRAINT "scope_nodes_reference_is_complete" CHECK (("scope_nodes"."references_node_id" is null) = ("scope_nodes"."reference_kind" is null)),
	CONSTRAINT "scope_nodes_settlement_is_an_allowance" CHECK ("scope_nodes"."allowance_settled_cents" is null or "scope_nodes"."node_type" = 'allowance')
);
--> statement-breakpoint
ALTER TABLE "change_order_details" ADD CONSTRAINT "change_order_details_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "change_order_details" ADD CONSTRAINT "change_order_details_parent_contract_id_documents_id_fk" FOREIGN KEY ("parent_contract_id") REFERENCES "public"."documents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contract_details" ADD CONSTRAINT "contract_details_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contract_details" ADD CONSTRAINT "contract_details_license_id_licenses_id_fk" FOREIGN KEY ("license_id") REFERENCES "public"."licenses"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_options" ADD CONSTRAINT "document_options_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_signatures" ADD CONSTRAINT "document_signatures_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_job_id_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."jobs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_source_document_id_documents_id_fk" FOREIGN KEY ("source_document_id") REFERENCES "public"."documents"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "auth"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoice_details" ADD CONSTRAINT "invoice_details_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "option_nodes" ADD CONSTRAINT "option_nodes_option_id_document_options_id_fk" FOREIGN KEY ("option_id") REFERENCES "public"."document_options"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "option_nodes" ADD CONSTRAINT "option_nodes_node_id_scope_nodes_id_fk" FOREIGN KEY ("node_id") REFERENCES "public"."scope_nodes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quote_details" ADD CONSTRAINT "quote_details_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quote_details" ADD CONSTRAINT "quote_details_license_id_licenses_id_fk" FOREIGN KEY ("license_id") REFERENCES "public"."licenses"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scope_nodes" ADD CONSTRAINT "scope_nodes_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scope_nodes" ADD CONSTRAINT "scope_nodes_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scope_nodes" ADD CONSTRAINT "scope_nodes_parent_node_id_scope_nodes_id_fk" FOREIGN KEY ("parent_node_id") REFERENCES "public"."scope_nodes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scope_nodes" ADD CONSTRAINT "scope_nodes_copied_from_node_id_scope_nodes_id_fk" FOREIGN KEY ("copied_from_node_id") REFERENCES "public"."scope_nodes"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scope_nodes" ADD CONSTRAINT "scope_nodes_references_node_id_scope_nodes_id_fk" FOREIGN KEY ("references_node_id") REFERENCES "public"."scope_nodes"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "document_options_document_idx" ON "document_options" USING btree ("document_id");--> statement-breakpoint
CREATE INDEX "document_signatures_document_idx" ON "document_signatures" USING btree ("document_id");--> statement-breakpoint
CREATE UNIQUE INDEX "document_signatures_party_unique" ON "document_signatures" USING btree ("document_id","party");--> statement-breakpoint
CREATE INDEX "documents_job_type_idx" ON "documents" USING btree ("organization_id","job_id","type");--> statement-breakpoint
CREATE INDEX "documents_status_idx" ON "documents" USING btree ("organization_id","status");--> statement-breakpoint
CREATE INDEX "documents_source_idx" ON "documents" USING btree ("source_document_id");--> statement-breakpoint
CREATE UNIQUE INDEX "documents_number_unique" ON "documents" USING btree ("organization_id","type","number");--> statement-breakpoint
CREATE INDEX "scope_nodes_document_idx" ON "scope_nodes" USING btree ("document_id","parent_node_id","position");--> statement-breakpoint
CREATE INDEX "scope_nodes_references_idx" ON "scope_nodes" USING btree ("references_node_id");--> statement-breakpoint
CREATE INDEX "scope_nodes_copied_from_idx" ON "scope_nodes" USING btree ("copied_from_node_id");--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- The freeze — Documents §7. GENERATED from lib/documents/lifecycle.ts by
-- `npm run documents:freeze-sql`. Edit that file, not this one.
--
-- One function does both halves, because they are two branches of one
-- question and splitting them across two BEFORE triggers would make the
-- outcome depend on alphabetical trigger firing order.
--
--   1. Already frozen? Everything outside the allowlist is refused.
--   2. Not yet frozen, and this update moves the status into the frozen set?
--      Stamp `frozen_at` here, so the lifecycle config is the only place the
--      rule is written and no caller can forget to set it.
--
-- Mutable after the freeze: status, sent_at, viewed_at, updated_at.
-- The freeze protects what was agreed, not what happened next — an invoice
-- still has to reach `paid` and `void` long after it is frozen.
-- ---------------------------------------------------------------------------
create or replace function public.documents_freeze()
returns trigger language plpgsql as $$
begin
  if TG_OP = 'DELETE' then
    if OLD.frozen_at is not null then
      raise exception
        'Document % is frozen and cannot be deleted. A document that was '
        'agreed to is a record, not a draft.', OLD.number;
    end if;
    return OLD;
  end if;

  if OLD.frozen_at is not null then
    if (
      NEW.id,
      NEW.organization_id,
      NEW.job_id,
      NEW.customer_id,
      NEW.type,
      NEW.number,
      NEW.source_document_id,
      NEW.title,
      NEW.summary,
      NEW.terms_text,
      NEW.header_snapshot,
      NEW.pack_id,
      NEW.issued_at,
      NEW.frozen_at,
      NEW.created_by,
      NEW.created_at
    ) is distinct from (
      OLD.id,
      OLD.organization_id,
      OLD.job_id,
      OLD.customer_id,
      OLD.type,
      OLD.number,
      OLD.source_document_id,
      OLD.title,
      OLD.summary,
      OLD.terms_text,
      OLD.header_snapshot,
      OLD.pack_id,
      OLD.issued_at,
      OLD.frozen_at,
      OLD.created_by,
      OLD.created_at
    )
    then
      raise exception
        'Document % is frozen (% %). Change what was agreed with a change '
        'order, never with an edit.', OLD.number, OLD.type, OLD.status;
    end if;
    return NEW;
  end if;

  if (NEW.type = 'quote' and NEW.status in ('accepted'))
     or (NEW.type = 'contract' and NEW.status in ('signed'))
     or (NEW.type = 'change_order' and NEW.status in ('approved'))
     or (NEW.type = 'invoice' and NEW.status in ('issued', 'sent', 'viewed', 'paid', 'void'))
  then
    NEW.frozen_at := now();
  end if;

  return NEW;
end $$;

drop trigger if exists documents_freeze on public.documents;
create trigger documents_freeze
  before update or delete on public.documents
  for each row execute function public.documents_freeze();

-- Nothing here moves once the document is frozen.
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
      NEW.selected_option_id
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
      OLD.selected_option_id
    )
  then
    raise exception 'Document % is frozen; % cannot be edited.', doc, 'quote_details';
  end if;

  return NEW;
end $$;

drop trigger if exists quote_details_freeze_guard on public.quote_details;
create trigger quote_details_freeze_guard
  before update or delete on public.quote_details
  for each row execute function public.quote_details_freeze_guard();

-- Nothing here moves once the document is frozen.
create or replace function public.contract_details_freeze_guard()
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
      NEW.contract_sum_cents,
      NEW.deposit_cents,
      NEW.deposit_basis,
      NEW.contract_type,
      NEW.billing_trigger,
      NEW.money_up_front,
      NEW.deposit_percent,
      NEW.progress_billing,
      NEW.retainage_percent,
      NEW.license_id,
      NEW.accepted_at
    ) is distinct from (
      OLD.document_id,
      OLD.contract_sum_cents,
      OLD.deposit_cents,
      OLD.deposit_basis,
      OLD.contract_type,
      OLD.billing_trigger,
      OLD.money_up_front,
      OLD.deposit_percent,
      OLD.progress_billing,
      OLD.retainage_percent,
      OLD.license_id,
      OLD.accepted_at
    )
  then
    raise exception 'Document % is frozen; % cannot be edited.', doc, 'contract_details';
  end if;

  return NEW;
end $$;

drop trigger if exists contract_details_freeze_guard on public.contract_details;
create trigger contract_details_freeze_guard
  before update or delete on public.contract_details
  for each row execute function public.contract_details_freeze_guard();

-- Mutable after the freeze: approved_at.
create or replace function public.change_order_details_freeze_guard()
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
      NEW.parent_contract_id,
      NEW.what_changed,
      NEW.delta_cents,
      NEW.time_impact_days
    ) is distinct from (
      OLD.document_id,
      OLD.parent_contract_id,
      OLD.what_changed,
      OLD.delta_cents,
      OLD.time_impact_days
    )
  then
    raise exception 'Document % is frozen; % cannot be edited.', doc, 'change_order_details';
  end if;

  return NEW;
end $$;

drop trigger if exists change_order_details_freeze_guard on public.change_order_details;
create trigger change_order_details_freeze_guard
  before update or delete on public.change_order_details
  for each row execute function public.change_order_details_freeze_guard();

-- Mutable after the freeze: gate_met_at, voided_at.
create or replace function public.invoice_details_freeze_guard()
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
      NEW.invoice_type,
      NEW.amount_due_cents,
      NEW.due_on,
      NEW.covers
    ) is distinct from (
      OLD.document_id,
      OLD.invoice_type,
      OLD.amount_due_cents,
      OLD.due_on,
      OLD.covers
    )
  then
    raise exception 'Document % is frozen; % cannot be edited.', doc, 'invoice_details';
  end if;

  return NEW;
end $$;

drop trigger if exists invoice_details_freeze_guard on public.invoice_details;
create trigger invoice_details_freeze_guard
  before update or delete on public.invoice_details
  for each row execute function public.invoice_details_freeze_guard();

-- ---------------------------------------------------------------------------
-- A frozen document's Scope freezes with it — §7.
--
-- Two columns are exempt and they are not really an exception: an allowance on
-- a *signed contract* settles when a change order points at it, and §4 puts the
-- settled amount on the allowance node itself so that "has this settled" is
-- answerable without walking every change order. The contract is frozen, so
-- either these move after the freeze or settlement has nowhere to write.
--
-- Mutable after the freeze: allowance_settled_cents, allowance_settled_at.
-- ---------------------------------------------------------------------------
create or replace function public.scope_nodes_freeze_guard()
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

  if TG_OP = 'INSERT' then
    raise exception
      'Document % is frozen; nothing can be added to its scope. Added work is '
      'a change order.', doc;
  end if;

  if TG_OP = 'DELETE' then
    raise exception
      'Document % is frozen; nothing can be removed from its scope. Removed '
      'work is a deduct change order.', doc;
  end if;

  if (
      NEW.id,
      NEW.organization_id,
      NEW.document_id,
      NEW.parent_node_id,
      NEW.position,
      NEW.node_type,
      NEW.section,
      NEW.optional,
      NEW.description,
      NEW.quantity,
      NEW.unit,
      NEW.unit_cost_cents,
      NEW.markup_bps,
      NEW.sell_price_cents,
      NEW.taxable,
      NEW.details,
      NEW.source,
      NEW.copied_from_node_id,
      NEW.references_node_id,
      NEW.reference_kind,
      NEW.created_at
    ) is distinct from (
      OLD.id,
      OLD.organization_id,
      OLD.document_id,
      OLD.parent_node_id,
      OLD.position,
      OLD.node_type,
      OLD.section,
      OLD.optional,
      OLD.description,
      OLD.quantity,
      OLD.unit,
      OLD.unit_cost_cents,
      OLD.markup_bps,
      OLD.sell_price_cents,
      OLD.taxable,
      OLD.details,
      OLD.source,
      OLD.copied_from_node_id,
      OLD.references_node_id,
      OLD.reference_kind,
      OLD.created_at
    )
  then
    raise exception 'Document % is frozen; its scope cannot be edited.', doc;
  end if;

  return NEW;
end $$;

drop trigger if exists scope_nodes_freeze_guard on public.scope_nodes;
create trigger scope_nodes_freeze_guard
  before insert or update or delete on public.scope_nodes
  for each row execute function public.scope_nodes_freeze_guard();

-- ---------------------------------------------------------------------------
-- Numbering — Documents §12, item 5.
--
-- Per organization *and* per type, so Q-0007 and INV-0007 are different
-- documents and a contractor reads them as such. Advisory-locked per
-- (org, type) for the same reason the job and quote counters are: two
-- documents created in the same second must not claim one number.
--
-- Gaps are acceptable and collisions are not — an abandoned draft burning a
-- number is fine, two live documents sharing one is not. The unique index is
-- the guard; this trigger is the convenience.
-- ---------------------------------------------------------------------------
create or replace function public.set_document_number()
returns trigger language plpgsql as $$
declare
  prefix text;
  next_n int;
begin
  if new.number is not null and new.number <> '' then
    return new;
  end if;

  prefix := case new.type
    when 'quote'        then 'Q'
    when 'contract'     then 'C'
    when 'change_order' then 'CO'
    when 'invoice'      then 'INV'
  end;

  perform pg_advisory_xact_lock(
    hashtextextended('document:' || new.organization_id::text || ':' || new.type::text, 0)
  );

  -- Read the counter off the numbers themselves rather than a side table, so
  -- there is nothing to keep in step. The trailing-digits match is what makes
  -- a hand-edited number harmless: it either parses and participates, or it is
  -- skipped.
  select coalesce(max(substring(d.number from '[0-9]+$')::int), 0) + 1
    into next_n
    from public.documents d
   where d.organization_id = new.organization_id
     and d.type = new.type
     and d.number ~ '[0-9]+$';

  new.number := prefix || '-' || lpad(next_n::text, 4, '0');
  return new;
end $$;--> statement-breakpoint

drop trigger if exists set_document_number on public.documents;--> statement-breakpoint
create trigger set_document_number
  before insert on public.documents
  for each row execute function public.set_document_number();--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- A change order amends a *contract*.
--
-- `parent_contract_id` is a foreign key to the spine, and the spine holds all
-- four types — so the key alone would happily let a change order amend a quote,
-- which is a category error the schema should refuse rather than the
-- application remember. Pricing added work with no agreement behind it is a
-- Quote.
-- ---------------------------------------------------------------------------
create or replace function public.change_order_parent_is_a_contract()
returns trigger language plpgsql as $$
declare
  parent_type public.document_type;
begin
  select d.type into parent_type
    from public.documents d where d.id = new.parent_contract_id;

  if parent_type is distinct from 'contract' then
    raise exception
      'A change order amends a contract, not a %.',
      coalesce(parent_type::text, 'missing document');
  end if;

  return new;
end $$;--> statement-breakpoint

drop trigger if exists change_order_parent_is_a_contract on public.change_order_details;--> statement-breakpoint
create trigger change_order_parent_is_a_contract
  before insert or update on public.change_order_details
  for each row execute function public.change_order_parent_is_a_contract();--> statement-breakpoint

-- updated_at, matching every other table in 0001.
drop trigger if exists set_updated_at on public.documents;--> statement-breakpoint
create trigger set_updated_at before update on public.documents
  for each row execute function public.set_updated_at();--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- RLS, same posture as `ledger_entries` and every other org-scoped table.
--
-- Drizzle connects as a role that bypasses this, so `lib/dal.ts` and the API's
-- `requireOrg` remain the real authorization. These are defence in depth for
-- anything arriving through PostgREST or the Supabase client.
--
-- The write rules are deliberately *not* duplicated here — the freeze triggers
-- above hold against the bypassing role too, which is the one product code
-- actually connects as, and a policy restating them would be a second
-- description of the rule to keep in step.
-- ---------------------------------------------------------------------------
alter table public.documents enable row level security;--> statement-breakpoint
create policy "documents: org members full access"
  on public.documents for all to authenticated
  using (public.is_org_member(organization_id))
  with check (public.is_org_member(organization_id));--> statement-breakpoint

alter table public.scope_nodes enable row level security;--> statement-breakpoint
create policy "scope_nodes: org members full access"
  on public.scope_nodes for all to authenticated
  using (public.is_org_member(organization_id))
  with check (public.is_org_member(organization_id));--> statement-breakpoint

-- The side tables carry no `organization_id` of their own: they belong to a
-- document and the document belongs to the shop, so the join is the scope.
alter table public.quote_details enable row level security;--> statement-breakpoint
create policy "quote_details: through the document"
  on public.quote_details for all to authenticated
  using (exists (select 1 from public.documents d
                  where d.id = document_id and public.is_org_member(d.organization_id)))
  with check (exists (select 1 from public.documents d
                  where d.id = document_id and public.is_org_member(d.organization_id)));--> statement-breakpoint

alter table public.contract_details enable row level security;--> statement-breakpoint
create policy "contract_details: through the document"
  on public.contract_details for all to authenticated
  using (exists (select 1 from public.documents d
                  where d.id = document_id and public.is_org_member(d.organization_id)))
  with check (exists (select 1 from public.documents d
                  where d.id = document_id and public.is_org_member(d.organization_id)));--> statement-breakpoint

alter table public.change_order_details enable row level security;--> statement-breakpoint
create policy "change_order_details: through the document"
  on public.change_order_details for all to authenticated
  using (exists (select 1 from public.documents d
                  where d.id = document_id and public.is_org_member(d.organization_id)))
  with check (exists (select 1 from public.documents d
                  where d.id = document_id and public.is_org_member(d.organization_id)));--> statement-breakpoint

alter table public.invoice_details enable row level security;--> statement-breakpoint
create policy "invoice_details: through the document"
  on public.invoice_details for all to authenticated
  using (exists (select 1 from public.documents d
                  where d.id = document_id and public.is_org_member(d.organization_id)))
  with check (exists (select 1 from public.documents d
                  where d.id = document_id and public.is_org_member(d.organization_id)));--> statement-breakpoint

alter table public.document_options enable row level security;--> statement-breakpoint
create policy "document_options: through the document"
  on public.document_options for all to authenticated
  using (exists (select 1 from public.documents d
                  where d.id = document_id and public.is_org_member(d.organization_id)))
  with check (exists (select 1 from public.documents d
                  where d.id = document_id and public.is_org_member(d.organization_id)));--> statement-breakpoint

alter table public.option_nodes enable row level security;--> statement-breakpoint
create policy "option_nodes: through the option"
  on public.option_nodes for all to authenticated
  using (exists (select 1 from public.document_options o
                  join public.documents d on d.id = o.document_id
                 where o.id = option_id and public.is_org_member(d.organization_id)))
  with check (exists (select 1 from public.document_options o
                  join public.documents d on d.id = o.document_id
                 where o.id = option_id and public.is_org_member(d.organization_id)));--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- Signatures are readable and appendable, never edited or deleted.
--
-- A signature is an audit record of intent, and ESIGN and UETA both expect one
-- that cannot be revised after the fact. Same posture as the ledger, and for
-- the same reason: a record you can edit is not evidence.
-- ---------------------------------------------------------------------------
alter table public.document_signatures enable row level security;--> statement-breakpoint
create policy "document_signatures: read through the document"
  on public.document_signatures for select to authenticated
  using (exists (select 1 from public.documents d
                  where d.id = document_id and public.is_org_member(d.organization_id)));--> statement-breakpoint
create policy "document_signatures: append through the document"
  on public.document_signatures for insert to authenticated
  with check (exists (select 1 from public.documents d
                  where d.id = document_id and public.is_org_member(d.organization_id)));--> statement-breakpoint

create or replace function public.document_signatures_are_append_only()
returns trigger language plpgsql as $$
begin
  raise exception
    'A signature is an audit record. It is never edited or deleted, and a '
    're-signature is a new document.';
end $$;--> statement-breakpoint

create trigger document_signatures_no_update
  before update or delete on public.document_signatures
  for each row execute function public.document_signatures_are_append_only();--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- The Contract freezes when the second signature lands — §5 and §6.
--
-- §5 says the Contract is mutable until both signatures are present and
-- immutable from that point. Signatures live in another table, so the freeze is
-- triggered by an INSERT somewhere else entirely — which the design doc left
-- unstated. Putting it here rather than in application code means a contract
-- cannot end up signed-but-editable because one code path forgot to freeze it.
--
-- One signature is the contractor's, applied automatically at generation. Two
-- is an agreement, and the update below trips `documents_freeze`, which stamps
-- `frozen_at` because `signed` is in the contract's frozen set.
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
     set status = case when signature_count >= 2 then 'signed' else 'part_signed' end
   where id = new.document_id
     and frozen_at is null;

  return new;
end $$;--> statement-breakpoint

create trigger contract_status_from_signatures
  after insert on public.document_signatures
  for each row execute function public.contract_status_from_signatures();
