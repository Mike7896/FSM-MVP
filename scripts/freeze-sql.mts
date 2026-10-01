/**
 * Emits the freeze SQL from `lib/documents/lifecycle.ts`.
 *
 * The freeze rule exists in two places by necessity — the database has to
 * enforce it, and the client has to disable exactly what the database would
 * reject, or a contractor fills in a form that then refuses to save. Two places
 * means drift, so only one of them is written by hand and this generates the
 * other.
 *
 *     npm run documents:freeze-sql          # print it
 *     npm run documents:freeze-sql -- --check   # fail if the migration is stale
 *
 * The output is pasted into the migration that creates these triggers. Re-run
 * it after changing a status set, and put the result in a new migration —
 * `create or replace function` makes that a clean forward-only change.
 */

import { readFileSync } from "node:fs";

import {
  DETAIL_MUTABLE_AFTER_FREEZE,
  FREEZES_AT,
  MUTABLE_AFTER_FREEZE,
  SCOPE_MUTABLE_AFTER_FREEZE,
  type DocumentType,
} from "@/lib/documents/lifecycle";

/** Every column on `documents`, in migration order. */
const DOCUMENT_COLUMNS = [
  "id",
  "organization_id",
  "job_id",
  "customer_id",
  "type",
  "number",
  "status",
  "source_document_id",
  "title",
  "summary",
  "terms_text",
  "header_snapshot",
  "pack_id",
  "issued_at",
  "sent_at",
  "viewed_at",
  "frozen_at",
  "created_by",
  "created_at",
  "updated_at",
] as const;

const DETAIL_COLUMNS: Record<string, readonly string[]> = {
  quote_details: [
    "document_id",
    "valid_until",
    "estimating_method",
    "estimate_class",
    "pricing_method",
    "price_structure",
    "contract_type",
    "cap_cents",
    "billing_trigger",
    "money_up_front",
    "deposit_percent",
    "progress_billing",
    "retainage_percent",
    "tax_rate",
    "commitment_summary",
    "license_id",
    "selected_option_id",
  ],
  contract_details: [
    "document_id",
    "contract_sum_cents",
    "deposit_cents",
    "deposit_basis",
    "contract_type",
    "billing_trigger",
    "money_up_front",
    "deposit_percent",
    "progress_billing",
    "retainage_percent",
    "license_id",
    "accepted_at",
  ],
  change_order_details: [
    "document_id",
    "parent_contract_id",
    "what_changed",
    "delta_cents",
    "time_impact_days",
    "tax_rate",
    "billing_mode",
    "base_amount_cents",
    "approved_at",
  ],
  invoice_details: [
    "document_id",
    "invoice_type",
    "amount_due_cents",
    "due_on",
    "covers",
    "gate_met_at",
    "voided_at",
  ],
};

const SCOPE_COLUMNS = [
  "id",
  "organization_id",
  "document_id",
  "parent_node_id",
  "position",
  "node_type",
  "section",
  "optional",
  "description",
  "quantity",
  "unit",
  "unit_cost_cents",
  "markup_bps",
  "sell_price_cents",
  "taxable",
  "details",
  "source",
  "copied_from_node_id",
  "references_node_id",
  "reference_kind",
  "allowance_settled_cents",
  "allowance_settled_at",
  "created_at",
] as const;

/** `(NEW.a, NEW.b) is distinct from (OLD.a, OLD.b)` over the guarded columns. */
function guardedComparison(
  columns: readonly string[],
  allowed: readonly string[]
): string {
  const guarded = columns.filter((column) => !allowed.includes(column));
  const side = (alias: string) =>
    guarded.map((column) => `${alias}.${column}`).join(",\n      ");

  return `(\n      ${side("NEW")}\n    ) is distinct from (\n      ${side("OLD")}\n    )`;
}

function documentsFreeze(): string {
  const freezing = (Object.keys(FREEZES_AT) as DocumentType[])
    .filter((type) => FREEZES_AT[type].length > 0)
    .map(
      (type) =>
        `(NEW.type = '${type}' and NEW.status in (${FREEZES_AT[type]
          .map((status) => `'${status}'`)
          .join(", ")}))`
    )
    .join("\n     or ");

  return `-- ---------------------------------------------------------------------------
-- The freeze — Documents §7. GENERATED from lib/documents/lifecycle.ts by
-- \`npm run documents:freeze-sql\`. Edit that file, not this one.
--
-- One function does both halves, because they are two branches of one
-- question and splitting them across two BEFORE triggers would make the
-- outcome depend on alphabetical trigger firing order.
--
--   1. Already frozen? Everything outside the allowlist is refused.
--   2. Not yet frozen, and this update moves the status into the frozen set?
--      Stamp \`frozen_at\` here, so the lifecycle config is the only place the
--      rule is written and no caller can forget to set it.
--
-- Mutable after the freeze: ${MUTABLE_AFTER_FREEZE.join(", ")}.
-- The freeze protects what was agreed, not what happened next — an invoice
-- still has to reach \`paid\` and \`void\` long after it is frozen.
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
    if ${guardedComparison(DOCUMENT_COLUMNS, MUTABLE_AFTER_FREEZE)}
    then
      raise exception
        'Document % is frozen (% %). Change what was agreed with a change '
        'order, never with an edit.', OLD.number, OLD.type, OLD.status;
    end if;
    return NEW;
  end if;

  if ${freezing}
  then
    NEW.frozen_at := now();
  end if;

  return NEW;
end $$;

drop trigger if exists documents_freeze on public.documents;
create trigger documents_freeze
  before update or delete on public.documents
  for each row execute function public.documents_freeze();`;
}

function detailFreeze(table: string): string {
  const allowed = DETAIL_MUTABLE_AFTER_FREEZE[table] ?? [];
  const note = allowed.length
    ? `-- Mutable after the freeze: ${allowed.join(", ")}.`
    : `-- Nothing here moves once the document is frozen.`;

  return `${note}
create or replace function public.${table}_freeze_guard()
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

  if ${guardedComparison(DETAIL_COLUMNS[table], allowed)}
  then
    raise exception 'Document % is frozen; % cannot be edited.', doc, '${table}';
  end if;

  return NEW;
end $$;

drop trigger if exists ${table}_freeze_guard on public.${table};
create trigger ${table}_freeze_guard
  before update or delete on public.${table}
  for each row execute function public.${table}_freeze_guard();`;
}

function scopeFreeze(): string {
  return `-- ---------------------------------------------------------------------------
-- A frozen document's Scope freezes with it — §7.
--
-- Two columns are exempt and they are not really an exception: an allowance on
-- a *signed contract* settles when a change order points at it, and §4 puts the
-- settled amount on the allowance node itself so that "has this settled" is
-- answerable without walking every change order. The contract is frozen, so
-- either these move after the freeze or settlement has nowhere to write.
--
-- Mutable after the freeze: ${SCOPE_MUTABLE_AFTER_FREEZE.join(", ")}.
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

  if ${guardedComparison(SCOPE_COLUMNS, SCOPE_MUTABLE_AFTER_FREEZE)}
  then
    raise exception 'Document % is frozen; its scope cannot be edited.', doc;
  end if;

  return NEW;
end $$;

drop trigger if exists scope_nodes_freeze_guard on public.scope_nodes;
create trigger scope_nodes_freeze_guard
  before insert or update or delete on public.scope_nodes
  for each row execute function public.scope_nodes_freeze_guard();`;
}

const sql = [
  documentsFreeze(),
  ...Object.keys(DETAIL_COLUMNS).map(detailFreeze),
  scopeFreeze(),
].join("\n\n");

if (process.argv.includes("--check")) {
  // Every generated statement must appear verbatim in some migration, or the
  // database is running a rule the config no longer describes.
  const migrations = readFileSync(
    new URL("../drizzle/0010_document_spine.sql", import.meta.url),
    "utf8"
  );
  const missing = sql
    .split("\n\n")
    .filter((block) => !migrations.includes(block.trim()));

  if (missing.length > 0) {
    console.error(
      `${missing.length} generated block(s) are not in the migration. ` +
        `Re-run \`npm run documents:freeze-sql\` and add the output as a new ` +
        `migration — \`create or replace\` makes that forward-only.`
    );
    process.exit(1);
  }
  console.log("Freeze SQL matches the migration.");
} else {
  console.log(sql);
}
