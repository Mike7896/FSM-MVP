import "server-only";
import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { jobs, permits } from "@/lib/db/schema";
import { DomainError } from "@/lib/errors";
export async function requireFieldJob(jobId: string, organizationId: string) {
  const [job] = await db.select().from(jobs).where(and(eq(jobs.id, jobId), eq(jobs.organizationId, organizationId))).limit(1);
  if (!job) throw new DomainError("That job doesn't exist.", "not_found");
  return job;
}
export async function requireFieldPermit(permitId: string, organizationId: string) {
  const [row] = await db.select({ permit: permits }).from(permits).innerJoin(jobs, eq(permits.jobId, jobs.id))
    .where(and(eq(permits.id, permitId), eq(jobs.organizationId, organizationId))).limit(1);
  if (!row) throw new DomainError("That permit doesn't exist.", "not_found");
  return row.permit;
}
