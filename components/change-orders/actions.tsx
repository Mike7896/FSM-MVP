"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { FileText, Loader2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { apiJson } from "@/lib/api/client";

/**
 * Bill an approved change on its own invoice — the one action a change order
 * has left once it's answered, and only when it was marked for separate
 * billing. Everything else rides on the next draw or the final balance.
 */
export function ChangeOrderActions({
  id,
  status,
  supplemental,
}: {
  id: string;
  jobId: string;
  status: string;
  supplemental: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (status !== "approved" || !supplemental) return null;

  async function bill() {
    setBusy(true);
    setError(null);
    try {
      const result = await apiJson<{ id: string }>(
        `/api/v1/change-orders/${id}/invoice`,
        "POST",
        {}
      );
      router.push(`/invoices/${result.id}`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Couldn't create the invoice.");
      setBusy(false);
    }
  }

  return (
    <>
      <Button disabled={busy} onClick={bill}>
        {busy ? <Loader2 className="animate-spin" /> : <FileText />}
        Bill it on its own invoice
      </Button>
      {error ? (
        <p role="alert" className="text-destructive basis-full text-sm">
          {error}
        </p>
      ) : null}
    </>
  );
}
