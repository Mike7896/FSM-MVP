"use client";

import { useState } from "react";
import { Loader2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { apiJson } from "@/lib/api/client";

/**
 * Approving the quote — the one primary action on the customer's page.
 *
 * Approval generates the contract, so this lands on it: the next page is the
 * agreement to sign, with the business's signature already on it.
 */
export function ApproveButton({
  token,
  hash,
  label,
}: {
  token: string;
  hash: string;
  label: string;
}) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function approve() {
    setPending(true);
    setError(null);

    try {
      const { next } = await apiJson<{ next: string }>(
        `/api/share/${token}/accept`,
        "POST",
        { hash }
      );
      window.location.assign(next);
    } catch (cause) {
      setError(
        cause instanceof TypeError
          ? "That didn't go through — check your connection and try again."
          : cause instanceof Error
            ? cause.message
            : "That didn't go through. Try again."
      );
      setPending(false);
    }
  }

  return (
    <div className="flex flex-col gap-2">
      <Button
        size="lg"
        className="h-12 text-base"
        onClick={approve}
        disabled={pending}
      >
        {pending ? <Loader2 className="animate-spin" /> : null}
        {label}
      </Button>
      {error ? (
        <p className="text-destructive text-center text-sm" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}
