"use client";
import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Camera, Paperclip } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { apiJson } from "@/lib/api/client";
import { parseMoney } from "@/lib/quote";
import { ATTACHMENT_TYPES, MAX_ATTACHMENT_BYTES } from "@/lib/schemas/receipt";

export function ReceiptForm({ jobId }: { jobId: string }) {
  const router = useRouter();
  const camera = useRef<HTMLInputElement>(null);
  const attachment = useRef<HTMLInputElement>(null);
  const recordId = useRef<string | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const uploaded = useRef<{ file: File; path: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  function choose(next?: File) {
    if (!next) return;
    if (next.size > MAX_ATTACHMENT_BYTES || !ATTACHMENT_TYPES.includes(next.type)) {
      setError("Choose a photo or PDF no larger than 20 MB."); return;
    }
    setFile(next); setError("");
  }
  async function save(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const amountCents = parseMoney(String(form.get("amount")));
    if (!amountCents || amountCents < 0) { setError("Enter the amount paid."); return; }
    setBusy(true); setError("");
    try {
      if (file && uploaded.current?.file !== file) {
        const slot = await apiJson<{ path: string; signedUrl: string }>(`/api/v1/jobs/${jobId}/receipts/upload`, "POST", { fileName: file.name });
        const response = await fetch(slot.signedUrl, { method: "PUT", headers: { "Content-Type": file.type }, body: file });
        if (!response.ok) throw new Error("The attachment didn't upload. Your entries are still here.");
        uploaded.current = { file, path: slot.path };
      }
      recordId.current ??= crypto.randomUUID();
      await apiJson(`/api/v1/jobs/${jobId}/receipts`, "POST", {
        id: recordId.current, vendor: form.get("vendor"), description: form.get("description"),
        amountCents, purchasedOn: form.get("purchasedOn"), storagePath: file ? uploaded.current?.path : null,
      });
      router.push(`/jobs/${jobId}#receipts`); router.refresh();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Couldn't save the receipt."); setBusy(false); }
  }
  return <form onSubmit={save} className="space-y-5">
    <fieldset disabled={busy} className="space-y-5">
      <input ref={camera} type="file" accept="image/*" capture="environment" className="hidden" onChange={e => choose(e.target.files?.[0])} />
      <input ref={attachment} type="file" accept={ATTACHMENT_TYPES.join(",")} className="hidden" onChange={e => choose(e.target.files?.[0])} />
      <div className="flex flex-wrap gap-3">
        <Button type="button" variant="outline" onClick={() => camera.current?.click()}><Camera />Snap the receipt</Button>
        <Button type="button" variant="outline" onClick={() => attachment.current?.click()}><Paperclip />Attach a photo or PDF</Button>
      </div>
      {file && <p className="text-sm">{file.name} <Button type="button" variant="ghost" onClick={() => setFile(null)}>Remove</Button></p>}
      <p className="text-muted-foreground text-sm">Enter the receipt details below. An attachment is optional.</p>
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="grid gap-2"><Label htmlFor="vendor">Vendor</Label><Input id="vendor" name="vendor" maxLength={200} /></div>
        <div className="grid gap-2"><Label htmlFor="amount">Amount paid ($)</Label><Input id="amount" name="amount" inputMode="decimal" required /></div>
        <div className="grid gap-2"><Label htmlFor="purchasedOn">Purchase date</Label><Input id="purchasedOn" name="purchasedOn" type="date" required /></div>
        <div className="grid gap-2"><Label htmlFor="description">What it was for</Label><Input id="description" name="description" maxLength={2000} /></div>
      </div>
      <Button type="submit">{busy ? "Saving…" : "Attach to this job"}</Button>
    </fieldset>
    {error && <p role="alert" className="text-destructive text-sm">{error}</p>}
  </form>;
}
