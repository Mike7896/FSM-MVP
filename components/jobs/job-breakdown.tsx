import Link from "next/link";
import { ArrowUpRight } from "lucide-react";

import type { JobAgreement } from "@/lib/queries/job-agreement";
import {
  baseTotal,
  formatMoney,
  isText,
  splitsByScope,
  type ScopeNode,
} from "@/lib/quote";
import { cn } from "@/lib/utils";

/**
 * What the job is made of — each part of the job and what it costs, beside the
 * phases being planned against it.
 *
 * **The contractor's view, not hers.** Every part is priced here whatever the
 * quote shows her, because "what was the second bedroom again?" is the
 * question he has while splitting the job into phases, and a quote that shows
 * her one total would leave it unanswered.
 *
 * Read from the contract once there is one, and from the quote until then.
 */
export function JobBreakdown({
  agreement,
  className,
}: {
  agreement: JobAgreement;
  className?: string;
}) {
  const { draft, sums, plan } = agreement;
  const byPhase = splitsByScope(draft.terms);
  const deposit = plan.find((payment) => payment.gate === "on_acceptance");
  const href =
    agreement.kind === "contract"
      ? `/jobs/${draft.jobId}/contract`
      : `/quotes/${agreement.documentId}`;

  const groups = byPhase
    ? plan
        .filter((payment) => payment.phaseKey !== null)
        .map((payment, index) => ({
          key: payment.phaseKey!,
          heading: `Phase ${index + 1}${
            payment.name && payment.name !== `Phase ${index + 1}` ? ` · ${payment.name}` : ""
          }`,
          bill: payment.amountCents,
          rows: payment.rows,
        }))
    : [{ key: "all", heading: null, bill: null, rows: draft.scope }];

  return (
    <section className={cn("flex flex-col gap-4 rounded-xl border p-5", className)}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="font-label text-[11px] uppercase">What the job is made of</h2>
          <p className="text-muted-foreground mt-1 text-xs">
            {agreement.kind === "contract"
              ? `From contract ${agreement.number}`
              : `From ${agreement.number}, not accepted yet`}
          </p>
        </div>
        <Link
          href={href}
          className="text-muted-foreground hover:text-foreground flex shrink-0 items-center gap-1 text-xs underline underline-offset-4"
        >
          Open {agreement.kind === "contract" ? "the contract" : "the quote"}
          <ArrowUpRight className="size-3" />
        </Link>
      </div>

      <div className="flex flex-col gap-4">
        {groups.map((group) => {
          const parts = group.rows.filter((node) => !isText(node) && !node.optional);
          return (
            <div key={group.key}>
              {group.heading ? (
                <p className="font-label mb-1 text-[10px] font-semibold uppercase">
                  {group.heading}
                </p>
              ) : null}
              {parts.length === 0 ? (
                <p className="text-muted-foreground border-t py-2 text-sm">
                  Nothing priced in this phase.
                </p>
              ) : (
                parts.map((node) => <Part key={node.key} node={node} />)
              )}
              {group.bill !== null ? (
                <div className="flex items-baseline justify-between gap-3 border-t pt-2 text-sm font-medium">
                  <span>Bills when it&apos;s done</span>
                  <span className="tabular-nums">{formatMoney(group.bill)}</span>
                </div>
              ) : null}
            </div>
          );
        })}
      </div>

      <dl className="flex flex-col text-sm">
        {sums.taxCents > 0 ? (
          <>
            <Figure label="Subtotal" cents={sums.subtotalCents} quiet />
            <Figure label="Tax" cents={sums.taxCents} quiet />
          </>
        ) : null}
        <Figure label="Total" cents={sums.totalCents} strong />
        {deposit ? (
          <Figure
            label={
              draft.terms.depositPercent
                ? `Deposit (${draft.terms.depositPercent}%)`
                : "Deposit"
            }
            cents={deposit.amountCents}
          />
        ) : null}
        {sums.optionalCents > 0 ? (
          <p className="text-muted-foreground border-t pt-2 text-xs">
            Plus {formatMoney(sums.optionalCents)} of optional work, not in the total.
          </p>
        ) : null}
      </dl>
    </section>
  );
}

/** A part of the job, and the rows directly inside it. */
function Part({ node }: { node: ScopeNode }) {
  const inside = node.children.filter((child) => !isText(child) && !child.optional);
  return (
    <div className="border-t py-2">
      <div className="flex items-baseline justify-between gap-3 text-sm">
        <span className="min-w-0 font-medium">{node.description.trim() || "Untitled row"}</span>
        <span className="shrink-0 tabular-nums">{formatMoney(baseTotal(node))}</span>
      </div>
      {inside.length ? (
        <ul className="mt-1 flex flex-col gap-0.5 pl-3">
          {inside.map((child) => (
            <li
              key={child.key}
              className="text-muted-foreground flex items-baseline justify-between gap-3 text-xs"
            >
              <span className="min-w-0 truncate">{child.description.trim() || "Untitled row"}</span>
              <span className="shrink-0 tabular-nums">{formatMoney(baseTotal(child))}</span>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

function Figure({
  label,
  cents,
  quiet = false,
  strong = false,
}: {
  label: string;
  cents: number;
  quiet?: boolean;
  strong?: boolean;
}) {
  return (
    <div
      className={cn(
        "flex items-baseline justify-between gap-3 border-t py-2",
        quiet && "text-muted-foreground"
      )}
    >
      <dt className={cn(strong && "font-label text-[11px] uppercase")}>{label}</dt>
      <dd className={cn("tabular-nums", strong && "text-lg font-semibold")}>
        {formatMoney(cents)}
      </dd>
    </div>
  );
}
