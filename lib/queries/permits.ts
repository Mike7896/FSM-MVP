import "server-only";

import { and, asc, eq } from "drizzle-orm";

import { db } from "@/lib/db";
import { customers, inspections, jobs, licenses, permits } from "@/lib/db/schema";

/**
 * Permits, and the inspections that run their lifecycle.
 *
 * **The product tracks permits; it does not file them.** Filing means
 * integrating with a specific authority having jurisdiction, and there are tens
 * of thousands of them with no common interface. Everything here is a record of
 * what the contractor did with the authority, not a channel to it.
 *
 * **Inspections nest inside the permit**, never listed top-level: an inspection
 * has no life outside the permit that scheduled it, the same relationship a
 * line item has to a quote. A flat inspection list is a screen nobody
 * navigates to — the cross-job question a contractor actually asks ("what's
 * waiting on an inspection") is answered on the dashboard as a gate.
 *
 * Scoped through `jobs`, because a Permit authorizes one piece of work at one
 * address and has no organization of its own.
 */

export type InspectionRow = {
  id: string;
  type: (typeof inspections.type.enumValues)[number];
  result: (typeof inspections.result.enumValues)[number];
  requestedOn: string | null;
  scheduledOn: string | null;
  completedOn: string | null;
  inspectorNotes: string | null;
  correctionsRequired: string | null;
  reinspectionFeeCents: number | null;
  /** The phase a passing result completes, if any. */
  clearsPhase: string | null;
};

export type PermitRow = {
  id: string;
  jobId: string;
  jurisdiction: string;
  type: string | null;
  number: string | null;
  scopeCovered: string | null;
  status: (typeof permits.status.enumValues)[number];
  pulledBy: (typeof permits.pulledBy.enumValues)[number];
  feePaidCents: number | null;
  appliedOn: string | null;
  issuedOn: string | null;
  expiresOn: string | null;
  placardUrl: string | null;
  /** The credential that authorized it, matched on jurisdiction. */
  licenseNumber: string | null;
  licenseJurisdiction: string | null;
  inspections: InspectionRow[];
};

export type JobPermits = {
  jobId: string;
  customerName: string;
  jobName: string | null;
  address: string | null;
  jurisdiction: string | null;
  permits: PermitRow[];
};

/** Every permit on a job, each with its inspections in schedule order. */
export async function getJobPermits(
  jobId: string,
  organizationId: string
): Promise<JobPermits | null> {
  const [job] = await db
    .select({
      jobId: jobs.id,
      jobName: jobs.name,
      address: jobs.address,
      jurisdiction: jobs.jurisdiction,
      customerName: customers.name,
    })
    .from(jobs)
    .innerJoin(customers, eq(jobs.customerId, customers.id))
    .where(and(eq(jobs.id, jobId), eq(jobs.organizationId, organizationId)))
    .limit(1);

  if (!job) return null;

  return { ...job, permits: await permitsFor(jobId) };
}

/** One permit, scoped through its job. */
export async function getPermit(
  permitId: string,
  organizationId: string
): Promise<(PermitRow & { customerName: string; address: string | null }) | null> {
  const [row] = await db
    .select({
      permit: permits,
      licenseNumber: licenses.number,
      licenseJurisdiction: licenses.jurisdiction,
      customerName: customers.name,
      address: jobs.address,
    })
    .from(permits)
    .innerJoin(jobs, eq(permits.jobId, jobs.id))
    .innerJoin(customers, eq(jobs.customerId, customers.id))
    .leftJoin(licenses, eq(permits.licenseId, licenses.id))
    .where(
      and(eq(permits.id, permitId), eq(jobs.organizationId, organizationId))
    )
    .limit(1);

  if (!row) return null;

  const rows = await db
    .select()
    .from(inspections)
    .where(eq(inspections.permitId, permitId))
    .orderBy(asc(inspections.scheduledOn), asc(inspections.createdAt));

  return {
    ...shape(row.permit),
    licenseNumber: row.licenseNumber,
    licenseJurisdiction: row.licenseJurisdiction,
    inspections: rows.map(shapeInspection),
    customerName: row.customerName,
    address: row.address,
  };
}

async function permitsFor(jobId: string): Promise<PermitRow[]> {
  const rows = await db
    .select({
      permit: permits,
      licenseNumber: licenses.number,
      licenseJurisdiction: licenses.jurisdiction,
    })
    .from(permits)
    .leftJoin(licenses, eq(permits.licenseId, licenses.id))
    .where(eq(permits.jobId, jobId))
    .orderBy(asc(permits.createdAt));

  if (rows.length === 0) return [];

  const all = await db
    .select()
    .from(inspections)
    .where(eq(inspections.jobId, jobId))
    .orderBy(asc(inspections.scheduledOn), asc(inspections.createdAt));

  return rows.map((row) => ({
    ...shape(row.permit),
    licenseNumber: row.licenseNumber,
    licenseJurisdiction: row.licenseJurisdiction,
    inspections: all
      .filter((inspection) => inspection.permitId === row.permit.id)
      .map(shapeInspection),
  }));
}

function shape(permit: typeof permits.$inferSelect) {
  return {
    id: permit.id,
    jobId: permit.jobId,
    jurisdiction: permit.jurisdiction,
    type: permit.type,
    number: permit.number,
    scopeCovered: permit.scopeCovered,
    status: permit.status,
    pulledBy: permit.pulledBy,
    feePaidCents: permit.feePaidCents,
    appliedOn: permit.appliedOn,
    issuedOn: permit.issuedOn,
    expiresOn: permit.expiresOn,
    placardUrl: permit.placardUrl,
    licenseNumber: null as string | null,
    licenseJurisdiction: null as string | null,
    inspections: [] as InspectionRow[],
  };
}

function shapeInspection(
  inspection: typeof inspections.$inferSelect
): InspectionRow {
  return {
    id: inspection.id,
    type: inspection.type,
    result: inspection.result,
    requestedOn: inspection.requestedOn,
    scheduledOn: inspection.scheduledOn,
    completedOn: inspection.completedOn,
    inspectorNotes: inspection.inspectorNotes,
    correctionsRequired: inspection.correctionsRequired,
    reinspectionFeeCents: inspection.reinspectionFeeCents,
    clearsPhase: inspection.clearsPhase,
  };
}
