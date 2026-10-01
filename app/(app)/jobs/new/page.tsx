import type { Metadata } from "next";

import { NewJobForm } from "@/components/jobs/new-job-form";
import { PageHeader } from "@/components/page-header";

export const metadata: Metadata = { title: "New job" };

/**
 * The job-first door — "several documents coming, you already know it."
 *
 * The other four doors create the Job silently behind whichever document comes
 * first. This one is for the contractor who is thinking in jobs rather than in
 * documents, and it lands in exactly the same tree.
 */
export default function NewJobPage() {
  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-8">
      <PageHeader
        title="New job"
        description="A shell to hang quotes, permits and invoices on."
      />
      <NewJobForm />
    </div>
  );
}
