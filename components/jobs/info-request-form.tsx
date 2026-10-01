"use client";
import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { apiJson } from "@/lib/api/client";
import type { InfoRequestView } from "@/lib/field/info-requests";

export function InfoRequestForm({ quoteId, customerEmail, emailEnabled, history }: { quoteId: string; customerEmail: string; emailEnabled: boolean; history: InfoRequestView[] }) {
  const router = useRouter();
  const identity = useRef<{ id: string; questions: string[] } | null>(null);
  const [questions, setQuestions] = useState([""]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState<{ id: string; url: string; emailed?: boolean; to?: string | null; deliveryError?: string } | null>(null);
  async function send(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    setBusy(true); setError("");
    try {
      identity.current ??= { id: crypto.randomUUID(), questions: questions.map(() => crypto.randomUUID()) };
      const request = result ?? await apiJson<{ id: string; url: string }>(`/api/v1/quotes/${quoteId}/info-requests`, "POST", {
        id: identity.current.id, questions: questions.map((prompt, i) => ({ id: identity.current!.questions[i] ?? crypto.randomUUID(), prompt })).filter(q => q.prompt.trim()),
        photoPrompt: data.get("photoPrompt"), note: data.get("note"),
      });
      setResult(request);
      const delivery = await apiJson<{ url: string; emailed: boolean; to?: string; deliveryError?: string }>(`/api/v1/quotes/${quoteId}/info-requests/${request.id}/send`, "POST", { channel: data.get("channel"), to: data.get("to") });
      setResult({ id: request.id, ...delivery }); router.refresh();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Couldn't save the request."); }
    finally { setBusy(false); }
  }
  return <div className="space-y-8">
    <form onSubmit={send} className="space-y-4">
      <fieldset disabled={busy || !!result} className="space-y-4">
        {questions.map((question, i) => <div key={i} className="grid gap-2"><Label htmlFor={`question-${i}`}>Question {i + 1}</Label><div className="flex gap-2"><Input id={`question-${i}`} value={question} maxLength={500} onChange={e => setQuestions(current => current.map((v, j) => i === j ? e.target.value : v))} /><Button type="button" variant="ghost" onClick={() => setQuestions(current => current.filter((_, j) => i !== j))}>Remove</Button></div></div>)}
        <Button type="button" variant="outline" disabled={questions.length >= 10} onClick={() => setQuestions(current => [...current, ""])}>Add a question</Button>
        <div className="grid gap-2"><Label htmlFor="photoPrompt">Ask for a photo</Label><Input id="photoPrompt" name="photoPrompt" maxLength={500} placeholder="What do you need a photo of?" /></div>
        <div className="grid gap-2"><Label htmlFor="request-note">Anything else</Label><Textarea id="request-note" name="note" maxLength={2000} /></div>
      </fieldset>
      <fieldset disabled={busy} className="space-y-3">
        <Label htmlFor="request-channel">Delivery</Label><select id="request-channel" name="channel" className="block rounded-md border border-input bg-background p-2" defaultValue={emailEnabled && customerEmail ? "email" : "link"}><option value="link">Get a link to share</option>{emailEnabled && <option value="email">Send by email</option>}</select>
        {emailEnabled && <div className="grid gap-2"><Label htmlFor="request-to">Customer email (for email delivery)</Label><Input id="request-to" type="email" name="to" defaultValue={customerEmail} /></div>}
        {!result?.emailed && <Button type="submit">{busy ? "Saving…" : result ? "Retry delivery" : "Send request"}</Button>}
      </fieldset>
      {error && <p role="alert" className="text-destructive text-sm">{error}</p>}
      {result && <div className="space-y-2 rounded-lg border p-4" role="status">
        <p>{result.emailed ? `Sent to ${result.to}.` : "Request saved. Share this link with your customer."}</p>
        {result.deliveryError && <p className="text-destructive">{result.deliveryError}</p>}
        <a className="block break-all underline" href={result.url}>{result.url}</a>
        <Button type="button" variant="outline" onClick={async () => { try { await navigator.clipboard.writeText(result.url); setError("Link copied."); } catch { setError("Select and copy the link above."); } }}>Copy link</Button>
        <Button type="button" variant="ghost" onClick={() => { setResult(null); identity.current = null; setError(""); }}>Write another request</Button>
      </div>}
    </form>
    <section className="space-y-4"><h2 className="font-medium">Requests and replies</h2>
      {history.length === 0 && <p className="text-muted-foreground text-sm">No requests yet.</p>}
      {history.map(row => <article key={row.id} className="space-y-3 rounded-lg border p-4">
        <p className="text-sm font-medium">{row.answeredAt ? "Customer replied" : "Waiting for a reply"} · {row.createdAt.slice(0, 10)}</p>
        {row.questions.map(q => <div key={q.id}><p className="text-sm font-medium">{q.prompt}</p><p className="whitespace-pre-wrap text-sm text-muted-foreground">{row.answers.find(a => a.questionId === q.id)?.text ?? "No answer yet"}</p></div>)}
        {row.photoPrompt && <p className="text-sm">Photo requested: {row.photoPrompt}</p>}
        {row.note && <p className="text-sm text-muted-foreground">{row.note}</p>}
        {row.photos.map((photo, i) => photo.url ? <a key={i} className="mr-3 text-sm underline" href={photo.url} target="_blank" rel="noopener noreferrer">View photo {i + 1}</a> : <p key={i}>Photo unavailable. Refresh to retry.</p>)}
        {!row.answeredAt && <Button type="button" variant="outline" onClick={async () => { try { const link = await apiJson<{ url: string }>(`/api/v1/quotes/${quoteId}/info-requests/${row.id}/send`, "POST", { channel: "link" }); setResult({ id: row.id, url: link.url }); } catch (cause) { setError(cause instanceof Error ? cause.message : "Couldn't get the link."); } }}>Share request again</Button>}
      </article>)}
    </section>
  </div>;
}
