"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

import {
  CustomerPicker,
  type PickedCustomer,
} from "@/components/jobs/customer-picker";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { apiJson } from "@/lib/api/client";

/**
 * The job-first door — a shell to hang quotes, permits and invoices on.
 *
 * The customer is the one thing a Job needs, so it is the one thing this form
 * insists on. Everything else can be filled in later from the job itself.
 *
 * Two ways out, because there are two reasons to open a job first: to record
 * it and move on (the job page), or because you're standing in front of the
 * work and want to start catching it (capture).
 */
export function NewJobForm() {
  const router = useRouter();
  const [customer, setCustomer] = useState<PickedCustomer | null>(null);
  const [address, setAddress] = useState("");
  /** Which of the two buttons is working, so only that one says so. */
  const [busy, setBusy] = useState<"job" | "capture" | null>(null);
  const [error, setError] = useState("");
  const [missingCustomer, setMissingCustomer] = useState(false);

  function chooseCustomer(picked: PickedCustomer) {
    setCustomer(picked);
    setMissingCustomer(false);
    // Their address on file is the likeliest place the work is. It only fills
    // an empty box — a second job for the same person can be somewhere else,
    // and whatever was typed here wins.
    if (!address.trim() && picked.address) setAddress(picked.address);
  }

  async function create(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const submitter = (event.nativeEvent as SubmitEvent).submitter;
    const thenCapture = submitter?.getAttribute("value") === "capture";

    if (!customer) {
      setMissingCustomer(true);
      setError("");
      return;
    }

    const data = new FormData(event.currentTarget);
    const text = (key: string) => String(data.get(key) ?? "").trim() || undefined;

    setBusy(thenCapture ? "capture" : "job");
    setError("");
    try {
      const job = await apiJson<{ id: string }>("/api/v1/jobs", "POST", {
        ...(customer.id
          ? { customerId: customer.id }
          : { customerName: customer.name }),
        name: text("name"),
        address: address.trim() || undefined,
        description: text("description"),
      });
      router.push(thenCapture ? `/jobs/${job.id}/capture` : `/jobs/${job.id}`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Couldn't create the job.");
      setBusy(null);
    }
  }

  return (
    <form onSubmit={create} className="flex flex-col gap-8">
      <fieldset
        disabled={busy !== null}
        className="flex flex-col gap-5 rounded-lg border p-5"
      >
        <div className="grid gap-2">
          <Label htmlFor="customer">Customer</Label>
          <CustomerPicker
            id="customer"
            value={customer}
            onChange={chooseCustomer}
            invalid={missingCustomer}
          />
          {missingCustomer ? (
            <p className="text-destructive text-xs">
              Pick who the work is for, or add them by name.
            </p>
          ) : null}
        </div>
        <div className="grid gap-2">
          <Label htmlFor="address">Address</Label>
          <Input
            id="address"
            maxLength={300}
            value={address}
            onChange={(event) => setAddress(event.target.value)}
          />
          <p className="text-muted-foreground text-xs">
            The address sets the jurisdiction, which is what a license and a
            permit are matched on.
          </p>
        </div>
        <div className="grid gap-2">
          <Label htmlFor="name">The work</Label>
          <Input
            id="name"
            name="name"
            maxLength={200}
            placeholder="What's the work?"
          />
        </div>
        <div className="grid gap-2">
          <Label htmlFor="description">Anything worth remembering</Label>
          <Textarea
            id="description"
            name="description"
            rows={3}
            maxLength={4000}
            placeholder="Optional."
          />
        </div>
      </fieldset>

      {error ? (
        <p role="alert" className="text-destructive text-sm">
          {error}
        </p>
      ) : null}

      {/* "Create job" comes first in the markup because Enter in any field
          presses the first submit button — and reversed on screen so it still
          sits on the right, where the primary action goes. */}
      <div className="flex flex-row-reverse justify-start gap-2">
        <Button type="submit" disabled={busy !== null}>
          {busy === "job" ? "Creating…" : "Create job"}
        </Button>
        <Button
          type="submit"
          name="then"
          value="capture"
          variant="outline"
          disabled={busy !== null}
        >
          {busy === "capture" ? "Creating…" : "Create and capture"}
        </Button>
      </div>
    </form>
  );
}
