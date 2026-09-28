"use client";
import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { apiJson } from "@/lib/api/client";
import { ATTACHMENT_TYPES, MAX_ATTACHMENT_BYTES } from "@/lib/schemas/receipt";
import type { InfoRequestView } from "@/lib/field/info-requests";

export function InfoRequestReply({ token, request }: { token: string; request: InfoRequestView }) {
  const router = useRouter();
  const [files, setFiles] = useState<File[]>([]);
  const uploaded = useRef(new Map<File, string>());
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(!!request.answeredAt);
  const [error, setError] = useState("");
  async function answer(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    if (request.photoPrompt && files.length === 0) { setError("Attach a photo before sending your reply."); return; }
    setBusy(true); setError("");
    try {
      const paths: string[] = [];
      for (const file of files) {
        let path = uploaded.current.get(file);
        if (!path) {
          const slot = await apiJson<{ path: string; signedUrl: string }>(`/api/share/${token}/info-requests/${request.id}/upload`, "POST", { fileName: file.name });
          const response = await fetch(slot.signedUrl, { method: "PUT", headers: { "Content-Type": file.type }, body: file });
          if (!response.ok) throw new Error("The photo didn't upload. Please try again.");
          path = slot.path; uploaded.current.set(file, path);
        }
        paths.push(path);
      }
      await apiJson(`/api/share/${token}/info-requests/${request.id}`, "POST", {
        answers: request.questions.map(q => ({ questionId: q.id, text: data.get(q.id) })), photoPaths: paths,
      });
      setDone(true); router.refresh();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Your reply didn't save. Try again."); }
    finally { setBusy(false); }
  }
  if (done) return <section className="bg-background rounded-xl border p-5 space-y-3">
    <h2 className="font-medium">Reply received</h2><p className="text-sm">Thank you. Your contractor can now review your answers and photos.</p>
    {request.questions.map(q => <div key={q.id}><p className="text-sm font-medium">{q.prompt}</p><p className="whitespace-pre-wrap text-sm">{request.answers.find(a => a.questionId === q.id)?.text}</p></div>)}
  </section>;
  return <section className="bg-background rounded-xl border p-5 space-y-4">
    <h2 className="font-medium">A few details for your quote</h2>
    {request.note && <p className="whitespace-pre-wrap text-sm">{request.note}</p>}
    <form onSubmit={answer} className="space-y-4"><fieldset disabled={busy} className="space-y-4">
      {request.questions.map(q => <div key={q.id} className="grid gap-2"><Label htmlFor={q.id}>{q.prompt}</Label><Textarea id={q.id} name={q.id} required maxLength={4000} /></div>)}
      {request.photoPrompt && <div className="grid gap-2"><Label htmlFor={`photos-${request.id}`}>{request.photoPrompt}</Label>
        <input id={`photos-${request.id}`} type="file" accept="image/jpeg,image/png,image/webp,image/heic,image/heif" multiple onChange={event => {
          const chosen = Array.from(event.target.files ?? []);
          if (chosen.length > 3 || chosen.some(f => f.size > MAX_ATTACHMENT_BYTES || !ATTACHMENT_TYPES.includes(f.type) || !f.type.startsWith("image/"))) { setError("Choose up to 3 photos, no larger than 10 MB each."); event.target.value = ""; return; }
          setFiles(chosen); setError("");
        }} />
        <p className="text-muted-foreground text-xs">Up to 3 photos, 10 MB each.</p>
        {files.map((file, i) => <p className="text-xs" key={i}>{file.name}</p>)}
      </div>}
      <Button type="submit" className="w-full">{busy ? "Sending…" : "Send my reply"}</Button>
    </fieldset>{error && <p className="text-destructive text-sm" role="alert">{error}</p>}</form>
  </section>;
}
