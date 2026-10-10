import type { Metadata } from "next";
import { and, eq } from "drizzle-orm";

import { NewQuoteSurface } from "@/components/quote-editor/surfaces";
import {
  getCurrentUser,
  requireActiveOrganization,
  requireSession,
} from "@/lib/dal";
import { db } from "@/lib/db";
import { customers, jobs } from "@/lib/db/schema";
import { emailConfigured } from "@/lib/email/send";
import { listCaptures } from "@/lib/queries/captures";
import { getCustomer } from "@/lib/queries/customers";
import { getQuote } from "@/lib/queries/quotes";
import {
  getOfficeDefaults,
  getOfficeIdentity,
  getOfficeSignature,
} from "@/lib/queries/office";

export const metadata: Metadata = { title: "New quote" };

/**
 * `/quotes/new` sits at the top level rather than under a Job, and that is
 * deliberate: at the moment the contractor starts one there is no Job yet. The
 * Job is created silently by whichever document comes first — here, by the
 * editor's first save.
 *
 * This is the *ordinary* editor — every quote after the first. It is the same
 * component the activation flow at `/welcome/quote` uses.
 *
 * `?seed=` carries a typed sentence in from anywhere that collects one; it
 * names the customer and the job, and nothing else. `?job=` starts a second
 * quote on a job that already exists, which is the only way this route has
 * captures to show.
 */
export default async function NewQuotePage({
  searchParams,
}: PageProps<"/quotes/new">) {
  const [org, session] = await Promise.all([
    requireActiveOrganization(),
    requireSession(),
  ]);
  const [{ seed, job, from, customer, customerName, title }, identity, signature, defaults, profile] =
    await Promise.all([
      searchParams,
      getOfficeIdentity(org.id),
      // What Acceptance draws on the business's signature line.
      getOfficeSignature(org.id),
      // Where every new quote begins. Copied into the draft at creation, never
      // read back — see `applyOfficeDefaults`.
      getOfficeDefaults(org.id),
      getCurrentUser(),
    ]);

  const office = { ...identity, signature };
  const jobId = typeof job === "string" ? job : undefined;

  // `?from=` is the dashboard's Quick start and the quotes list's Duplicate.
  // The source is read and used to seed the editor — nothing is written until
  // the first save, so opening a template and changing your mind leaves no
  // half-finished quote behind.
  const [captures, template, forCustomer, [existingJob]] = await Promise.all([
    jobId ? listCaptures(jobId, org.id) : Promise.resolve([]),
    typeof from === "string" ? getQuote(from, org.id) : Promise.resolve(null),
    // `?customer=` comes from a customer's page. Their name arrives filled in
    // and their id goes with the create call, so quoting the same person twice
    // does not produce two of them in the directory.
    typeof customer === "string"
      ? getCustomer(customer, org.id)
      : Promise.resolve(null),
    // A second quote on an existing job carries that job's demo flag, and
    // already knows where its customer gets email.
    jobId
      ? db
          .select({ demo: jobs.isDemo, customerEmail: customers.email })
          .from(jobs)
          .leftJoin(customers, eq(jobs.customerId, customers.id))
          .where(and(eq(jobs.id, jobId), eq(jobs.organizationId, org.id)))
          .limit(1)
      : Promise.resolve([]),
  ]);

  return (
    /**
     * Full bleed inside the shell.
     *
     * The app layout pads every page with `p-4 md:p-6`, which is right for a
     * list and wrong for a work surface — the editor's own header bar and
     * column dividers are supposed to meet the edges of the content region, and
     * inside that padding they instead outline a card floating on the page.
     * The negative margin cancels exactly that padding rather than the layout
     * growing a per-page exception.
     */
    <div className="-m-4 flex min-h-0 flex-1 flex-col md:-m-6">
      <NewQuoteSurface
        seedText={typeof seed === "string" ? seed : undefined}
        customerName={typeof customerName === "string" ? customerName : undefined}
        title={typeof title === "string" ? title : undefined}
        template={template ?? undefined}
        jobId={jobId}
        customer={
          forCustomer
            ? { id: forCustomer.id, name: forCustomer.name }
            : undefined
        }
        office={office}
        defaults={defaults}
        captures={captures}
        demo={existingJob?.demo ?? false}
        send={{
          emailEnabled: emailConfigured(),
          selfEmail: session.email,
          selfPhone: profile?.phone ?? null,
          customerEmail:
            forCustomer?.email ?? existingJob?.customerEmail ?? null,
        }}
      />
    </div>
  );
}
