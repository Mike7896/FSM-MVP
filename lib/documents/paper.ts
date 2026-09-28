import type {
  SharedChangeOrder,
  SharedContract,
  SharedDocument,
  SharedInvoice,
  SharedQuote,
} from "@/lib/queries/share";
import {
  baseTotal,
  formatChange,
  formatMoney,
  isText,
  nodeTotal,
  termsSentence,
  totals,
  unpricedRows,
  type QuoteDraft,
  type ScopeNode,
} from "@/lib/quote";
import type { DocumentSignatures, LineSignature } from "@/lib/signing/lines";
import type { OfficeIdentity } from "@/lib/queries/office";

/**
 * A document as a sheet of paper — the one shape the PDF, the email and the
 * customer's page are all drawn from.
 *
 * **Three renderers, one reading.** The page on the customer's link is React
 * in a browser, the attachment is a PDF, the email is tables and inline styles
 * for an inbox — three technologies that share no components. What they share
 * is this: the same letterhead, the same rows in the same order, the same
 * totals and the same sentence about the money, worked out once. So the copy
 * she prints, the copy in her inbox and the copy on her phone cannot disagree.
 *
 * Built from what the customer's link shows (`SharedDocument`), never from the
 * contractor's records — cost, markup and internal notes are not in the input,
 * so they cannot end up on the paper.
 */

export type PaperLine = {
  description: string;
  /** A second, quieter line — "An allowance — trued up to the actual cost". */
  detail?: string | null;
  /** Formatted, or null for a line that carries no money. */
  amount: string | null;
};

export type PaperSignature = {
  /** Whose line it is — "For Reyes Electric", "Dana Whitfield". */
  who: string;
  /** Said under a signed line instead of `who`, so a name isn't printed twice. */
  role: string | null;
  printedName: string | null;
  signedAt: Date | null;
  /** The stored mark — `typed:…` or `drawn:…`. */
  mark: string | null;
};

export type PaperBlock =
  | { kind: "text"; heading?: string; body: string; quiet?: boolean }
  | { kind: "lines"; heading?: string; lines: PaperLine[] }
  | {
      kind: "totals";
      lines: { label: string; value: string }[];
      total: { label: string; value: string };
    }
  | { kind: "list"; heading: string; items: string[] }
  | { kind: "offer"; heading: string; lines: PaperLine[]; note: string }
  | { kind: "signatures"; heading: string; note: string; lines: PaperSignature[] };

export type PaperDocument = {
  kind: SharedDocument["kind"];
  /** The document's word — "Quote", "Contract", "Deposit invoice". */
  label: string;
  number: string | null;
  letterhead: {
    name: string | null;
    license: string | null;
    phone: string | null;
    logoUrl: string | null;
  };
  preparedFor: string | null;
  jobAddress: string | null;
  title: string | null;
  demo: boolean;
  blocks: PaperBlock[];
  /** What the foot of every page says — "Q-0009 · Reyes Electric". */
  footer: string;
  /** "Made with ServiceClerk" beside it — Free-plan documents only (Billing §2.2). */
  promoFooter: boolean;
  /** "Quote Q-0009 - Reyes Electric.pdf" */
  filename: string;
};

/* ── Builders ──────────────────────────────────────────────────────────── */

export function paperFor(shared: SharedDocument): PaperDocument {
  switch (shared.kind) {
    case "quote":
      return quotePaper(shared);
    case "contract":
      return contractPaper(shared);
    case "change_order":
      return changeOrderPaper(shared);
    case "invoice":
      return invoicePaper(shared);
  }
}

/**
 * A quote's paper — the same sections, in the same order, as the page the
 * customer opens (`QuoteProjection`).
 */
export function quotePaper(
  shared: Pick<SharedQuote, "draft" | "office" | "schedule" | "signatures" | "demo" | "jobAddress">
): PaperDocument {
  return draftPaper({
    label: "Quote",
    draft: shared.draft,
    office: shared.office,
    schedule: shared.schedule,
    signatures: shared.draft.signatureLines ? shared.signatures : null,
    demo: shared.demo,
    jobAddress: shared.jobAddress,
    offerOptional: true,
  });
}

/** A contract's paper: the agreed scope, and always its signature lines. */
export function contractPaper(shared: SharedContract): PaperDocument {
  const line = (party: "contractor" | "customer") => {
    const signature = shared.signatures.find((entry) => entry.party === party);
    return signature
      ? {
          mark: signature.signatureData,
          printedName: signature.printedName,
          signedAt: signature.signedAt,
        }
      : null;
  };

  return draftPaper({
    label: "Contract",
    draft: shared.draft,
    office: shared.office,
    schedule: [],
    signatures: { contractor: line("contractor"), customer: line("customer") },
    demo: shared.demo,
    jobAddress: shared.jobAddress,
    // Agreed means agreed: an optional row she didn't take isn't on offer.
    offerOptional: false,
  });
}

function draftPaper({
  label,
  draft,
  office,
  schedule,
  signatures,
  demo,
  jobAddress,
  offerOptional,
}: {
  label: string;
  draft: QuoteDraft;
  office: OfficeIdentity;
  schedule: { name: string; when: string; amountCents: number }[];
  signatures: DocumentSignatures | null;
  demo: boolean;
  jobAddress: string | null;
  offerOptional: boolean;
}): PaperDocument {
  const sums = totals(draft);
  const blocks: PaperBlock[] = [];

  if (draft.scopeOfWork.trim()) {
    blocks.push({ kind: "text", body: draft.scopeOfWork.trim(), quiet: true });
  }

  // Top level only — a group is one row with its subtotal, the way her page
  // reads it.
  const rows = draft.scope.filter((node) => !isText(node) && !node.optional);
  if (rows.length) {
    blocks.push({
      kind: "lines",
      lines: rows.map((node) => ({
        description: node.description || "Work",
        detail:
          node.type === "allowance"
            ? "An allowance — trued up to the actual cost once you choose."
            : null,
        amount: formatMoney(baseTotal(node)),
      })),
    });
    blocks.push({
      kind: "totals",
      lines:
        sums.taxCents > 0
          ? [
              { label: "Subtotal", value: formatMoney(sums.subtotalCents) },
              { label: "Tax", value: formatMoney(sums.taxCents) },
            ]
          : [],
      total: { label: "Total", value: formatMoney(sums.totalCents) },
    });
  }

  if (offerOptional) {
    const optional = collectOptional(draft.scope);
    if (optional.length) {
      blocks.push({
        kind: "offer",
        heading: "You can add",
        lines: optional.map((node) => ({
          description: node.description || "Extra work",
          amount: `+${formatMoney(nodeTotal(node))}`,
        })),
        note: "Ask for any of these and your total updates.",
      });
    }
  }

  const { exclusions, assumptions, notes } = unpricedRows(draft);
  for (const [heading, nodes] of [
    ["Not included", exclusions],
    ["Conditions this price assumes", assumptions],
    ["Please note", notes],
  ] as const) {
    const items = nodes.map((node) => node.description.trim()).filter(Boolean);
    if (items.length) blocks.push({ kind: "list", heading, items });
  }

  blocks.push({ kind: "text", body: termsSentence(draft, sums) });

  if (schedule.length) {
    blocks.push({
      kind: "lines",
      heading: "How you'll pay",
      lines: schedule.map((stage) => ({
        description: stage.name,
        detail: stage.when,
        amount: formatMoney(stage.amountCents),
      })),
    });
  }

  if (signatures) {
    blocks.push(
      signatureBlock(office.businessName, draft.customerName, signatures)
    );
  }

  return {
    kind: label === "Contract" ? "contract" : "quote",
    label,
    number: draft.number,
    letterhead: letterheadOf(office),
    preparedFor: draft.customerName.trim() || null,
    jobAddress,
    title: draft.title.trim() || null,
    demo,
    blocks,
    ...naming(label, draft.number, office.businessName),
    promoFooter: office.promoFooter ?? true,
  };
}

/** A change order's paper: what's changing, the money before and after. */
export function changeOrderPaper(shared: SharedChangeOrder): PaperDocument {
  const blocks: PaperBlock[] = [];

  if (shared.summary?.trim()) {
    blocks.push({ kind: "text", body: shared.summary.trim(), quiet: true });
  }
  const priced = shared.lines.filter((line) => line.description.trim());
  if (priced.length) {
    blocks.push({
      kind: "lines",
      lines: priced.map((line) => ({
        description: line.description,
        amount: line.amountCents === null ? null : formatChange(line.amountCents),
      })),
    });
  }
  blocks.push({
    kind: "totals",
    lines: [
      { label: "Agreed total before this change", value: formatMoney(shared.baseAmountCents) },
      { label: "This change, including tax", value: formatChange(shared.deltaCents) },
    ],
    total: {
      label: "Total with this change",
      value: formatMoney(shared.baseAmountCents + shared.deltaCents),
    },
  });
  blocks.push({
    kind: "text",
    body: [
      shared.timeImpactDays === 0
        ? "It doesn't change the schedule."
        : `It ${shared.timeImpactDays > 0 ? "adds" : "takes off"} ${Math.abs(shared.timeImpactDays)} ${Math.abs(shared.timeImpactDays) === 1 ? "day" : "days"}.`,
      shared.billingMode === "supplemental"
        ? "Once approved, it's billed on its own invoice."
        : "Once approved, it goes into the remaining payments.",
      "Everything else in your contract stays as signed.",
    ].join(" "),
  });
  blocks.push(
    signatureBlock(shared.office.businessName, shared.customerName, {
      contractor: shared.signatures.contractor,
      customer: shared.signatures.customer,
    }, "Signed by both of you, this changes your contract as described above.")
  );

  return {
    kind: "change_order",
    label: "Change order",
    number: shared.number,
    letterhead: letterheadOf(shared.office),
    preparedFor: shared.customerName,
    jobAddress: shared.jobAddress,
    title: shared.title,
    demo: shared.demo,
    blocks,
    ...naming("Change order", shared.number, shared.office.businessName),
    promoFooter: shared.office.promoFooter ?? true,
  };
}

const INVOICE_WORDS = {
  deposit: "Deposit invoice",
  draw: "Progress invoice",
  final_balance: "Final invoice",
} as const;

/** An invoice's paper: what it's for, how it's worked out, what's left. */
export function invoicePaper(shared: SharedInvoice): PaperDocument {
  const label = INVOICE_WORDS[shared.invoiceType];
  const blocks: PaperBlock[] = [];

  if (shared.voided) {
    blocks.push({
      kind: "text",
      body: `${shared.office.businessName ?? "The business"} withdrew this invoice. Nothing is owed on it.`,
    });
  }
  if (shared.evidence?.summary?.trim()) {
    blocks.push({
      kind: "text",
      heading: "What this pays for",
      body: shared.evidence.summary.trim(),
    });
  }
  if (shared.settlement) {
    blocks.push({
      kind: "lines",
      heading: "How this balance is worked out",
      lines: [
        {
          description: "The work you agreed to",
          amount: formatMoney(shared.settlement.contractSumCents),
        },
        ...shared.settlement.changeOrders.map((change) => ({
          description: change.whatChanged ?? `Change you approved · ${change.number}`,
          amount: formatChange(change.deltaCents),
        })),
        ...shared.settlement.priorBills.map((bill) => ({
          description: bill.covers ?? `Already billed · ${bill.number}`,
          amount: formatChange(-bill.amountCents),
        })),
      ],
    });
  }
  blocks.push({
    kind: "totals",
    lines: [
      { label: "Amount", value: formatMoney(shared.amountDueCents) },
      ...(shared.paidCents > 0
        ? [{ label: "Paid so far", value: formatChange(-shared.paidCents) }]
        : []),
    ],
    total: { label: "Left to pay", value: formatMoney(shared.outstandingCents) },
  });
  if (shared.dueOn && shared.outstandingCents > 0 && !shared.voided) {
    blocks.push({ kind: "text", body: `Due ${calendarDay(shared.dueOn)}.` });
  }

  return {
    kind: "invoice",
    label,
    number: shared.number,
    letterhead: letterheadOf(shared.office),
    preparedFor: shared.customerName,
    jobAddress: shared.jobAddress,
    title: shared.covers?.trim() || null,
    demo: shared.demo,
    blocks,
    ...naming(label, shared.number, shared.office.businessName),
    promoFooter: shared.office.promoFooter ?? true,
  };
}

/* ── Pieces ────────────────────────────────────────────────────────────── */

function signatureBlock(
  businessName: string | null,
  customerName: string | null,
  signatures: DocumentSignatures,
  note = "Signed by both of you, this is an agreement to the work, price and terms above."
): PaperBlock {
  const customer = customerName?.trim() || "Customer";
  return {
    kind: "signatures",
    heading: "Acceptance",
    note,
    lines: [
      line(businessName ? `For ${businessName}` : "For the business", null, signatures.contractor),
      line(customer, "Customer", signatures.customer),
    ],
  };
}

function line(
  who: string,
  role: string | null,
  signature: LineSignature | null
): PaperSignature {
  return {
    who,
    role: role && signature && signature.printedName.trim() === who ? role : null,
    printedName: signature?.printedName ?? null,
    signedAt: signature?.signedAt ? new Date(signature.signedAt) : null,
    mark: signature?.mark ?? null,
  };
}

function letterheadOf(office: OfficeIdentity): PaperDocument["letterhead"] {
  return {
    name: office.businessName,
    license: office.license,
    phone: office.phone,
    logoUrl: office.logoUrl ?? null,
  };
}

function naming(label: string, number: string | null, business: string | null) {
  const footer = [number, business].filter(Boolean).join(" · ");
  const name = [label, number].filter(Boolean).join(" ");
  const filename = `${[name, business].filter(Boolean).join(" - ")}.pdf`
    // Nothing a file system or a mail client could choke on.
    .replace(/[\\/:*?"<>|\r\n]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return { footer, filename };
}

/** The optional rows, outermost only — see `QuoteProjection`. */
function collectOptional(scope: ScopeNode[]): ScopeNode[] {
  const out: ScopeNode[] = [];
  const step = (nodes: ScopeNode[]) => {
    for (const node of nodes) {
      if (node.optional) {
        if (!isText(node)) out.push(node);
        continue;
      }
      if (node.children.length) step(node.children);
    }
  };
  step(scope);
  return out;
}

/** "October 14" — a calendar date as stored, read in its own day. */
export function calendarDay(iso: string) {
  return new Date(`${iso}T12:00:00Z`).toLocaleDateString("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  });
}

/** "Sep 27, 2026" — a signature's date, where the paper prints one. */
export function paperDate(date: Date) {
  return date.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}
