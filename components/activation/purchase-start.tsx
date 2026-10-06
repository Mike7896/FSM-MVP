"use client";

import Link from "next/link";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";

/** Create the Office before entering the authenticated checkout pages. */
export function PurchaseStart({ query }: { query: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const selection = new URLSearchParams(query);
  async function continueToBill() {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch("/api/v1/organizations", {
        method: "POST", headers: { "Content-Type": "application/json" }, body: "{}",
      });
      if (!response.ok && response.status !== 409) throw new Error("Couldn't create your Office. Please try again.");
      router.push(`/upgrade/checkout?${query}`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Please try again.");
      setBusy(false);
    }
  }
  return <div className="mx-auto flex w-full max-w-lg flex-col gap-6 px-4 py-12">
    <h1 className="text-3xl font-semibold tracking-tight">Review your selected plan</h1>
    <p>You chose {selection.get("plan") === "pro" ? "Pro" : "Starter"}, billed {selection.get("interval") === "year" ? "yearly" : "monthly"}{selection.has("pack") ? ", with the Electrical pack" : ""}. We’ll set up your Office, then show your bill before you pay.</p>
    {error ? <p role="alert" className="text-destructive">{error}</p> : null}
    <Button onClick={continueToBill} disabled={busy}>{busy ? "Setting up your Office…" : "Continue to my bill"}</Button>
    <Link href="/welcome" className="text-center text-sm underline underline-offset-4">Start on Free instead</Link>
  </div>;
}
