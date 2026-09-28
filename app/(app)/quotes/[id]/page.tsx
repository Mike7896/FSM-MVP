import { RecordTagSection } from "@/components/tags/record-tags";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { eq } from "drizzle-orm";

import { ExistingQuoteSurface } from "@/components/quote-editor/surfaces";
import {
  getCurrentUser,
  requireActiveOrganization,
  requireSession,
} from "@/lib/dal";
import { db } from "@/lib/db";
import { customers, jobs } from "@/lib/db/schema";
import { emailConfigured } from "@/lib/email/send";
import { listCaptures } from "@/lib/queries/captures";
import { getQuote } from "@/lib/queries/quotes";
import { getOfficeIdentity, getOfficeSignature } from "@/lib/queries/office";

export const metadata: Metadata = { title: "Quote" };

/**
 * The editor takes the whole content region and is not a modal — the
 * destination nav stays visible beside it, because at the desk leaving the
 * editor is a click and losing your place costs nothing (13a).
 *
 * **No `PageHeader` here.** The editor draws its own header bar: customer,
 * saved state, and the send action, per 19a. Two headers stacked above one
 * document is one header too many, and the wrong one carries the primary
 * action.
 */
export default async function QuotePage({ params }: PageProps<"/quotes/[id]">) {
  const [org, session] = await Promise.all([
    requireActiveOrganization(),
    requireSession(),
  ]);
  const { id } = await params;

  // Scoped to the organization inside the query rather than filtered after —
  // Drizzle bypasses RLS, so a quote from another shop must never come back at
  // all, not come back and get hidden.
  const record = await getQuote(id, org.id);
  if (!record) notFound();

  const [profile, identity, signature, captures, [job]] = await Promise.all([
    getCurrentUser(),
    getOfficeIdentity(org.id),
    // What Acceptance draws on the business's signature line.
    getOfficeSignature(org.id),
    listCaptures(record.jobId, org.id),
    db
      .select({
        address: jobs.address,
        demo: jobs.isDemo,
        customerEmail: customers.email,
      })
      .from(jobs)
      .leftJoin(customers, eq(jobs.customerId, customers.id))
      .where(eq(jobs.id, record.jobId))
      .limit(1),
  ]);
  const office = { ...identity, signature };

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
      <div className="border-b bg-card px-4 py-2 md:px-6"><RecordTagSection organizationId={org.id} entity="quote" recordId={id} /></div>
      <ExistingQuoteSurface
        record={record}
        office={office}
        captures={captures}
        address={job?.address}
        demo={job?.demo ?? false}
        send={{
          emailEnabled: emailConfigured(),
          selfEmail: session.email,
          selfPhone: profile?.phone ?? null,
          customerEmail: job?.customerEmail ?? null,
        }}
      />
    </div>
  );
}
