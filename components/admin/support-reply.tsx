"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";

type Reply = { id: string; body: string; recipient: string; sentAt: string | null; createdAt: string };
export function SupportReply({ requestId, recipient, onSent }: { requestId: string; recipient: string; onSent: () => void }) {
  const [replies, setReplies] = useState<Reply[]>([]);
  const [configured, setConfigured] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState("");
  const [body, setBody] = useState("");
  const [attempt, setAttempt] = useState<{ id: string; body: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [reload, setReload] = useState(0);
  useEffect(() => {
    let cancelled = false;
    fetch(`/api/v1/admin/support/${requestId}/replies`).then(async response => {
      const result = await response.json();
      if (!response.ok) throw new Error(result.error?.message ?? "Couldn't load replies.");
      if (!cancelled) { setReplies(result.data.replies); setConfigured(result.data.configured); setLoaded(true); setError(""); }
    }).catch(() => { if (!cancelled) setError("Couldn't load replies. Try again."); });
    return () => { cancelled = true; };
  }, [requestId, reload]);

  async function send(payload: { id: string; body: string }) {
    setBusy(true);
    setError("");
    try {
      const response = await fetch(`/api/v1/admin/support/${requestId}/replies`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error?.message ?? "Couldn't send this reply.");
      setReplies(current => [...current.filter(reply => reply.id !== result.data.id), result.data]);
      setAttempt(null); setBody(""); toast.success("Reply sent. Request marked answered."); onSent();
    } catch (error) { setError(error instanceof Error ? error.message : "The send could not be confirmed. Retry this reply."); }
    finally { setBusy(false); }
  }
  return <section className="mt-2 space-y-3 border-t pt-3" aria-label="Email replies">
    <h3 className="font-medium">Email conversation</h3>
    {replies.map(reply => <article key={reply.id} className="bg-background rounded-md border p-3"><p className="text-muted-foreground mb-2">{reply.sentAt ? "Sent" : "Send unconfirmed"} · {new Date(reply.sentAt ?? reply.createdAt).toLocaleString()} · {reply.recipient}</p><p className="whitespace-pre-wrap">{reply.body}</p>{!reply.sentAt && <Button className="mt-2" size="sm" variant="outline" disabled={busy || !configured} onClick={() => send({ id: reply.id, body: reply.body })}>Retry saved reply</Button>}</article>)}
    {error && <p role="alert" className="text-destructive">{error}</p>}
    {!loaded ? <Button size="sm" variant="outline" onClick={() => setReload(value => value + 1)}>{error ? "Reload replies" : "Loading replies…"}</Button> : !configured ? <p className="text-muted-foreground">Email replies require RESEND_API_KEY and SUPPORT_EMAIL in the server configuration.</p> : <form className="space-y-2" onSubmit={event => { event.preventDefault(); const payload = attempt ?? { id: crypto.randomUUID(), body: body.trim() }; setAttempt(payload); void send(payload); }}>
      <label htmlFor={`reply-${requestId}`} className="block">Reply to {recipient}</label>
      <Textarea id={`reply-${requestId}`} required maxLength={10000} rows={5} value={attempt?.body ?? body} disabled={busy || !!attempt} onChange={event => setBody(event.target.value)} placeholder="Write your reply…" />
      <p className="text-muted-foreground">Replies from the customer go to your support inbox.</p>
      <Button size="sm" disabled={busy || !(attempt?.body ?? body).trim()}>{busy ? "Sending…" : attempt ? "Retry reply" : "Send reply"}</Button>
    </form>}
  </section>;
}
