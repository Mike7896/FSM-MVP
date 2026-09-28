"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Loader2, Printer } from "lucide-react";

import { Button } from "@/components/ui/button";
import { reportFreeLimit } from "@/lib/membership/limit-event";

/**
 * Print, which is also how a PDF is made today.
 *
 * Every browser's print dialog can save to PDF, and the page it prints is the
 * page on screen — so this is a real PDF button rather than a promise of one.
 *
 * **A customer-ready copy activates the job** on the Free plan (Billing
 * §3.1), once; a job that's already been sent costs nothing. At the month's
 * limit the upgrade sheet opens instead, and a watermarked draft copy — which
 * never counts — is still one click away.
 */
export function PrintButton({
  label = "Print or save as PDF",
  jobId,
}: {
  label?: string;
  /** The job this document belongs to. Without it, printing is free. */
  jobId?: string;
}) {
  const [pending, setPending] = useState(false);
  const [limited, setLimited] = useState(false);

  async function print() {
    if (!jobId) {
      window.print();
      return;
    }
    setPending(true);
    try {
      const response = await fetch(`/api/v1/jobs/${jobId}/activation`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "pdf" }),
      });
      if (!response.ok) {
        const body = (await response.json().catch(() => null)) as { error?: unknown } | null;
        if (reportFreeLimit(body?.error)) {
          setLimited(true);
          return;
        }
        throw new Error("Could not confirm this job's PDF allowance. Please try again.");
      }
      window.print();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not prepare the PDF. Please try again.");
    } finally {
      setPending(false);
    }
  }

  function printDraft() {
    document.body.dataset.printDraft = "true";
    window.print();
    delete document.body.dataset.printDraft;
  }

  return (
    <div className="flex items-center gap-2">
      {limited ? (
        <Button variant="ghost" onClick={printDraft}>
          Print a draft copy
        </Button>
      ) : null}
      <Button variant="outline" onClick={print} disabled={pending}>
        {pending ? <Loader2 className="animate-spin" /> : <Printer />}
        {label}
      </Button>
    </div>
  );
}
