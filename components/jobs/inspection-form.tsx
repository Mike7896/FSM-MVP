"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { apiJson } from "@/lib/api/client";
import { moneyInputValue, parseMoney } from "@/lib/quote";
import { inspectionTypeValues, inspectionResultValues } from "@/lib/schemas/permit";
import type { InspectionRow } from "@/lib/queries/permits";

export function InspectionForm({ permitId, initial, phases }: { permitId: string; initial?: InspectionRow; phases: string[] }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);
  const prefix = initial?.id ?? "new-inspection";
  async function save(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    const body: Record<string, unknown> = {};
    const keys = initial ? ["type", "scheduledOn", "requestedOn", "clearsPhase", "result", "completedOn", "inspectorNotes", "correctionsRequired"] : ["type", "scheduledOn", "requestedOn", "clearsPhase"];
    for (const key of keys) { const value = String(data.get(key) ?? "").trim(); if (value) body[key] = value; else if (initial) body[key] = null; }
    if (!initial) body.permitId = permitId;
    if (initial) {
      const fee = String(data.get("fee") ?? "").trim();
      const cents = fee ? parseMoney(fee) : null;
      if (fee && (cents === null || cents < 0)) { setError("Enter a valid re-inspection fee."); return; }
      body.reinspectionFeeCents = cents;
    }
    setBusy(true); setError(""); setSaved(false);
    try {
      await apiJson(initial ? `/api/v1/inspections/${initial.id}` : "/api/v1/inspections", initial ? "PATCH" : "POST", body);
      if (!initial) form.reset();
      setSaved(true); router.refresh();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Couldn't save the inspection."); }
    finally { setBusy(false); }
  }
  return <form onSubmit={save} className="space-y-4"><fieldset disabled={busy} className="grid gap-4 sm:grid-cols-2">
    <div className="grid gap-2"><Label htmlFor={`${prefix}-type`}>Inspection type</Label><select id={`${prefix}-type`} name="type" defaultValue={initial?.type ?? "rough_in"} className="rounded-md border border-input bg-background p-2">{inspectionTypeValues.map(value => <option key={value} value={value}>{value.replaceAll("_", " ")}</option>)}</select></div>
    {(["requestedOn", "scheduledOn"] as const).map((key, i) => <div key={key} className="grid gap-2"><Label htmlFor={`${prefix}-${key}`}>{["Requested on", "Scheduled on"][i]}</Label><Input id={`${prefix}-${key}`} name={key} type="date" defaultValue={initial?.[key] ?? ""} /></div>)}
    <div className="grid gap-2"><Label htmlFor={`${prefix}-phase`}>Passing clears this phase</Label><select id={`${prefix}-phase`} name="clearsPhase" defaultValue={initial?.clearsPhase ?? ""} className="rounded-md border border-input bg-background p-2"><option value="">No linked phase</option>{Array.from(new Set([...phases, ...(initial?.clearsPhase ? [initial.clearsPhase] : [])])).map(name => <option key={name}>{name}</option>)}</select></div>
    {initial && <>
      <div className="grid gap-2"><Label htmlFor={`${prefix}-result`}>Result</Label><select id={`${prefix}-result`} name="result" defaultValue={initial.result} className="rounded-md border border-input bg-background p-2">{inspectionResultValues.map(value => <option key={value}>{value}</option>)}</select></div>
      <div className="grid gap-2"><Label htmlFor={`${prefix}-completed`}>Completed on</Label><Input id={`${prefix}-completed`} name="completedOn" type="date" defaultValue={initial.completedOn ?? ""} /></div>
      <div className="grid gap-2"><Label htmlFor={`${prefix}-notes`}>Inspector notes</Label><Textarea id={`${prefix}-notes`} name="inspectorNotes" maxLength={4000} defaultValue={initial.inspectorNotes ?? ""} /></div>
      <div className="grid gap-2"><Label htmlFor={`${prefix}-corrections`}>Corrections required</Label><Textarea id={`${prefix}-corrections`} name="correctionsRequired" maxLength={4000} defaultValue={initial.correctionsRequired ?? ""} /></div>
      <div className="grid gap-2"><Label htmlFor={`${prefix}-fee`}>Re-inspection fee ($)</Label><Input id={`${prefix}-fee`} name="fee" inputMode="decimal" defaultValue={initial.reinspectionFeeCents == null ? "" : moneyInputValue(initial.reinspectionFeeCents)} /></div>
    </>}
    <Button type="submit">{busy ? "Saving…" : initial ? "Save inspection" : "Record scheduled inspection"}</Button>
  </fieldset>
  {!initial && <p className="text-muted-foreground text-xs">Record the appointment arranged with your local authority. This does not book it with them.</p>}
  {error && <p role="alert" className="text-destructive text-sm">{error}</p>}{saved && <p role="status" className="text-sm">Inspection saved.</p>}
  </form>;
}
