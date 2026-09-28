import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { CalendarPlus } from "lucide-react";

import { PageHeader } from "@/components/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { requireActiveOrganization } from "@/lib/dal";
import { getPermit } from "@/lib/queries/permits";
import { formatMoney } from "@/lib/quote";
import { PermitForm } from "@/components/jobs/permit-form";
import { InspectionForm } from "@/components/jobs/inspection-form";
import { db } from "@/lib/db";
import { drawSchedule } from "@/lib/db/schema";
import { eq } from "drizzle-orm";

export const metadata: Metadata = { title: "Permit" };

/**
 * Permit detail and its inspections · job L1.
 *
 * **The inspection cycle is the permit's lifecycle.** Residential electrical
 * work runs a rough-in inspection before walls close and a final after the
 * system is energized. A failed inspection means corrections and a
 * re-inspection, commonly with a fee.
 *
 * **A passing inspection and a completed phase are frequently the same
 * moment** — rough-in passing is exactly when a contractor is entitled to a
 * draw — which is why `clearsPhase` is carried on the inspection and surfaced
 * here rather than recorded and forgotten.
 */

const RESULT_VARIANT: Record<
  string,
  "default" | "secondary" | "outline" | "destructive"
> = {
  passed: "default",
  failed: "destructive",
  scheduled: "secondary",
  cancelled: "outline",
};

export default async function PermitDetailPage({
  params,
}: PageProps<"/jobs/[id]/permits/[permitId]">) {
  const org = await requireActiveOrganization();
  const { id, permitId } = await params;

  const permit = await getPermit(permitId, org.id);
  if (!permit || permit.jobId !== id) notFound();
  const phases = await db.select({ name: drawSchedule.name }).from(drawSchedule).where(eq(drawSchedule.jobId, id));
  const phaseNames = phases.map(row => row.name);

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-8">
      <PageHeader
        title={[permit.jurisdiction, permit.type].filter(Boolean).join(" ")}
        description={[
          permit.number ? `#${permit.number}` : "No number issued yet",
          `pulled by the ${permit.pulledBy}`,
          permit.licenseNumber ? `on licence ${permit.licenseNumber}` : null,
        ]
          .filter(Boolean)
          .join(" · ")}
        actions={
          <Button variant="outline" asChild>
            <a href="#schedule-inspection">
            <CalendarPlus />
            Schedule an inspection
            </a>
          </Button>
        }
      />

      <div className="grid gap-4 rounded-lg border p-5 sm:grid-cols-2">
        <Field label="Status">
          <Badge variant="secondary" className="capitalize">
            {permit.status.replace(/_/g, " ")}
          </Badge>
        </Field>
        <Field label="Fee paid">
          {permit.feePaidCents !== null
            ? formatMoney(permit.feePaidCents)
            : "Not recorded"}
        </Field>
        <Field label="Applied">{permit.appliedOn ?? "—"}</Field>
        <Field label="Issued">{permit.issuedOn ?? "—"}</Field>
        <Field label="Expires">
          {/* Permits expire on inactivity rather than a fixed clock, which is
              why this is a date on the record and not a countdown. */}
          {permit.expiresOn ?? "—"}
        </Field>
        <Field label="Jurisdiction">{permit.jurisdiction}</Field>
      </div>

      {permit.scopeCovered ? (
        <section className="rounded-lg border p-5">
          <p className="text-muted-foreground font-label text-[11px] uppercase">
            Scope covered
          </p>
          <p className="mt-2 text-sm leading-relaxed">{permit.scopeCovered}</p>
        </section>
      ) : null}

      <details className="rounded-lg border p-5">
        <summary className="cursor-pointer font-medium">Edit permit details</summary>
        <div className="mt-5"><PermitForm jobId={id} initial={permit} /></div>
      </details>
      <section id="schedule-inspection" className="scroll-mt-24 rounded-lg border p-5 space-y-4">
        <h2 className="font-medium">Schedule an inspection</h2>
        <InspectionForm permitId={permitId} phases={phaseNames} />
      </section>
      <section>
        <p className="text-muted-foreground mb-2 font-label text-[11px] uppercase">
          Inspections
        </p>
        {permit.inspections.length === 0 ? (
          <p className="text-muted-foreground border-t py-4 text-sm">
            Nothing scheduled yet.
          </p>
        ) : (
          permit.inspections.map((inspection) => (
            <div key={inspection.id} className="border-t py-4">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <span className="text-sm font-medium capitalize">
                  {inspection.type.replace(/_/g, " ")}
                </span>
                <span className="flex items-center gap-2">
                  <span className="text-muted-foreground text-xs">
                    {inspection.completedOn ??
                      inspection.scheduledOn ??
                      "No date"}
                  </span>
                  <Badge
                    variant={RESULT_VARIANT[inspection.result] ?? "outline"}
                    className="capitalize"
                  >
                    {inspection.result}
                  </Badge>
                </span>
              </div>

              {inspection.correctionsRequired ? (
                <p className="text-destructive mt-1.5 text-sm leading-relaxed">
                  Corrections: {inspection.correctionsRequired}
                </p>
              ) : null}
              {inspection.inspectorNotes ? (
                <p className="text-muted-foreground mt-1 text-sm leading-relaxed">
                  {inspection.inspectorNotes}
                </p>
              ) : null}
              {inspection.reinspectionFeeCents ? (
                <p className="text-muted-foreground mt-1 text-xs">
                  Re-inspection fee{" "}
                  {formatMoney(inspection.reinspectionFeeCents)}
                </p>
              ) : null}
              {/* The draw this passing result entitles him to. */}
              {inspection.clearsPhase ? (
                <p className="text-muted-foreground mt-1 text-xs">
                  {inspection.result === "passed"
                    ? `Cleared "${inspection.clearsPhase}" — that draw is billable.`
                    : `Passing this clears "${inspection.clearsPhase}".`}
                </p>
              ) : null}
              <details className="mt-3">
                <summary className="cursor-pointer text-sm underline">Record result or edit inspection</summary>
                <div className="mt-4"><InspectionForm permitId={permitId} initial={inspection} phases={phaseNames} /></div>
              </details>
            </div>
          ))
        )}
      </section>
    </div>
  );
}

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <p className="text-muted-foreground font-label text-[10px] uppercase">
        {label}
      </p>
      <div className="mt-1 text-sm">{children}</div>
    </div>
  );
}
