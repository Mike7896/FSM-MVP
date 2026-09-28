import Link from "next/link";
import type { Metadata } from "next";

import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

export const metadata: Metadata = { title: "New contract" };

/**
 * Screen 60 · Contract with no source Quote.
 *
 * The genuinely blocked one. A Contract written without a Quote has **no five
 * decisions behind it**, and the terms are generated *from* those decisions —
 * so whether this path collects the decisions directly, inherits them from a
 * Preset, or is a simpler shape entirely is undecided, and drawing the full
 * form now produces a screen that gets thrown away.
 *
 * What is settled: the door exists, the route is fixed, and the resulting
 * object is a complete Contract rather than a lesser variant of one.
 */
export default function NewContractPage() {
  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-8">
      <PageHeader
        title="New contract"
        description="You agreed it on the phone and never quoted it."
      />

      <div className="flex flex-col gap-5 rounded-lg border p-5">
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="grid gap-2">
            <Label htmlFor="customer">Customer</Label>
            <Input id="customer" placeholder="Who did you agree this with?" />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="address">Job address</Label>
            <Input id="address" placeholder="Sets the jurisdiction and license" />
          </div>
        </div>
        <div className="grid gap-2">
          <Label htmlFor="scope">Scope of work</Label>
          <Textarea
            id="scope"
            rows={5}
            placeholder="The full agreed scope — not a summary. A summary creates a gap between what was agreed and what was described, and that gap lands on you in a dispute."
          />
        </div>
        <div className="grid gap-2">
          <Label htmlFor="price">Agreed price</Label>
          <Input id="price" placeholder="$0.00" inputMode="decimal" />
        </div>
      </div>

      {/* Said plainly rather than left to a button that does nothing: a form
          that looks finished hides that it can't send yet. The working path to
          a signed contract today is an approved quote. */}
      <div className="flex flex-col items-start gap-4 border-t pt-5 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-muted-foreground text-sm">
          Sending a contract from here isn&apos;t built yet. For now, contracts
          come from approved quotes —{" "}
          <Link
            href="/quotes/new"
            className="text-foreground underline underline-offset-4"
          >
            write a quote
          </Link>{" "}
          and the contract is made when your customer says yes.
        </p>
        <Button disabled className="shrink-0">
          Send for signature
        </Button>
      </div>
    </div>
  );
}
