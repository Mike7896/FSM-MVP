"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { apiJson } from "@/lib/api/client";
import { parseMoney, moneyInputValue } from "@/lib/quote";
import { permitStatusValues, permitPullerValues } from "@/lib/schemas/permit";

type Initial = { id?: string; jurisdiction: string; type?: string | null; number?: string | null; scopeCovered?: string | null; status?: string; pulledBy?: string; feePaidCents?: number | null; appliedOn?: string | null; issuedOn?: string | null; expiresOn?: string | null };
export function PermitForm({ jobId, initial }: { jobId: string; initial: Initial }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function save(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const body: Record<string, unknown> = {};
    for (const key of ["jurisdiction", "type", "number", "scopeCovered", "status", "pulledBy", "appliedOn", "issuedOn", "expiresOn"]) {
      const value = String(data.get(key) ?? "").trim();
      if (value) body[key] = value;
      else if (initial.id) body[key] = null;
    }
    const fee = String(data.get("fee"));
    if (fee.trim()) {
      const cents = parseMoney(fee);
      if (cents === null || cents < 0) { setError("Enter a valid fee, or leave it blank."); return; }
      body.feePaidCents = cents;
    } else if (initial.id) body.feePaidCents = null;
    if (!initial.id) body.jobId = jobId;
    setBusy(true); setError("");
    try {
      const saved = await apiJson<{ id: string }>(initial.id ? `/api/v1/permits/${initial.id}` : "/api/v1/permits", initial.id ? "PATCH" : "POST", body);
      router.push(`/jobs/${jobId}/permits/${saved.id}`); router.refresh();
      setBusy(false);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Couldn't save the permit."); setBusy(false); }
  }
  return <form onSubmit={save} className="space-y-4"><fieldset disabled={busy} className="grid gap-4 sm:grid-cols-2">
    <div className="grid gap-2"><Label htmlFor="jurisdiction">Jurisdiction</Label><Input id="jurisdiction" name="jurisdiction" required maxLength={120} defaultValue={initial.jurisdiction} /><p className="text-muted-foreground text-xs">Check the authority responsible for this address.</p></div>
    <div className="grid gap-2"><Label htmlFor="permit-type">Permit type</Label><Input id="permit-type" name="type" maxLength={80} defaultValue={initial.type ?? ""} /></div>
    <div className="grid gap-2"><Label htmlFor="permit-status">Status</Label><select id="permit-status" name="status" defaultValue={initial.status ?? "needed"} className="rounded-md border border-input bg-background p-2">{permitStatusValues.map(value => <option key={value} value={value}>{value.replaceAll("_", " ")}</option>)}</select></div>
    <div className="grid gap-2"><Label htmlFor="pulledBy">Who pulled it</Label><select id="pulledBy" name="pulledBy" defaultValue={initial.pulledBy ?? "shop"} className="rounded-md border border-input bg-background p-2">{permitPullerValues.map(value => <option key={value} value={value}>{value === "shop" ? "Our business" : value}</option>)}</select></div>
    <div className="grid gap-2"><Label htmlFor="number">Permit number</Label><Input id="number" name="number" maxLength={80} defaultValue={initial.number ?? ""} /></div>
    <div className="grid gap-2"><Label htmlFor="fee">Fee paid ($)</Label><Input id="fee" name="fee" inputMode="decimal" defaultValue={initial.feePaidCents == null ? "" : moneyInputValue(initial.feePaidCents)} /></div>
    {(["appliedOn", "issuedOn", "expiresOn"] as const).map((key, index) => <div className="grid gap-2" key={key}><Label htmlFor={key}>{["Applied on", "Issued on", "Expires on"][index]}</Label><Input id={key} name={key} type="date" defaultValue={initial[key] ?? ""} /></div>)}
    <div className="grid gap-2 sm:col-span-2"><Label htmlFor="scopeCovered">Scope covered</Label><Input id="scopeCovered" name="scopeCovered" maxLength={2000} defaultValue={initial.scopeCovered ?? ""} /></div>
    <Button type="submit">{busy ? "Saving…" : "Save permit"}</Button>
  </fieldset>{error && <p role="alert" className="text-destructive text-sm">{error}</p>}</form>;
}
