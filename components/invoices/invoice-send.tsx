"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Check, Copy, Link2, Loader2, Mail } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { apiJson } from "@/lib/api/client";

/**
 * Sending a bill — email first, like every document.
 *
 * **Email** goes through the product in the business's name: his words, the
 * amount and what it covers, and the button she pays from. **Copying the link**
 * is the fallback for passing it on by hand, and becomes the main action only
 * where email isn't set up. The link is never optional: it is how she pays, and
 * it is the same link pattern she has used since the quote.
 */
export function InvoiceSend({
  invoiceId,
  customerName,
  customerEmail,
  amountLabel,
  emailEnabled,
  sent,
  shareUrl,
}: {
  invoiceId: string;
  customerName: string;
  customerEmail: string | null;
  amountLabel: string;
  /** Whether this deployment can send email at all. */
  emailEnabled: boolean;
  /** Whether it has already gone out once. */
  sent: boolean;
  shareUrl: string | null;
}) {
  const router = useRouter();
  const firstName = customerName.trim().split(/\s+/)[0] || "your customer";

  const [to, setTo] = useState(customerEmail ?? "");
  const [message, setMessage] = useState("");
  const [sending, setSending] = useState<"email" | "link" | null>(null);
  const [url, setUrl] = useState<string | null>(shareUrl);
  const [copied, setCopied] = useState(false);

  const addressOk = /^\S+@\S+\.\S+$/.test(to.trim());

  async function submit(channel: "email" | "link") {
    if (sending !== null || (channel === "email" && !addressOk)) return;
    setSending(channel);

    try {
      const result = await apiJson<{ url: string; to: string | null }>(
        `/api/v1/invoices/${invoiceId}/send`,
        "POST",
        {
          channel,
          ...(channel === "email" ? { to: to.trim() } : {}),
          ...(message.trim() ? { message: message.trim() } : {}),
        }
      );

      setUrl(result.url);
      if (channel === "email") {
        toast.success(`Emailed to ${result.to}.`);
      } else {
        await copy(result.url);
      }
      router.refresh();
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "That didn't go out. Try again."
      );
    } finally {
      setSending(null);
    }
  }

  async function copy(link = url) {
    if (!link) return;
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
      toast.success(`Link copied — ready to send to ${firstName}.`);
    } catch {
      toast.error("Couldn't copy it. Select the link and copy it by hand.");
    }
  }

  return (
    <section className="flex flex-col gap-4 rounded-xl border p-5">
      <div>
        <p className="font-label text-[11px] uppercase">
          {sent ? "Email it again" : `Email it to ${firstName}`}
        </p>
        <p className="text-muted-foreground mt-1 text-sm">
          {sent
            ? "They already have this link. Sending again uses the same one."
            : "They pay from the link in the email — no account, same page as the quote."}
        </p>
      </div>

      {emailEnabled ? null : (
        <p className="bg-muted/50 rounded-lg border p-3 text-sm leading-relaxed">
          Email isn&apos;t set up yet, so this can&apos;t be sent from here. You
          can copy the link and send it yourself for now.
        </p>
      )}

      <div className="grid gap-1.5">
        <Label htmlFor="invoice-to">To</Label>
        <Input
          id="invoice-to"
          type="email"
          value={to}
          onChange={(event) => setTo(event.target.value)}
          autoComplete="email"
          disabled={sending !== null || !emailEnabled}
        />
      </div>

      <div className="grid gap-1.5">
        <Label htmlFor="invoice-message">
          Message{" "}
          <span className="text-muted-foreground font-normal">(optional)</span>
        </Label>
        <Textarea
          id="invoice-message"
          rows={3}
          className="min-h-24"
          value={message}
          onChange={(event) => setMessage(event.target.value)}
          disabled={sending !== null}
        />
        <p className="text-muted-foreground text-xs">
          Left blank, it says what the bill is for. The amount and the pay
          button go underneath either way.
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {emailEnabled ? (
          <Button onClick={() => submit("email")} disabled={sending !== null || !addressOk}>
            {sending === "email" ? <Loader2 className="animate-spin" /> : <Mail className="size-4" />}
            Email {amountLabel}
          </Button>
        ) : null}

        {url ? (
          <Button
            type="button"
            variant={emailEnabled ? "ghost" : "default"}
            className={emailEnabled ? "text-muted-foreground" : undefined}
            onClick={() => copy()}
          >
            {copied ? <Check className="size-4" /> : <Copy className="size-4" />}
            {copied ? "Copied" : emailEnabled ? "Copy the link instead" : "Copy the link"}
          </Button>
        ) : (
          <Button
            type="button"
            variant={emailEnabled ? "ghost" : "default"}
            className={emailEnabled ? "text-muted-foreground" : undefined}
            onClick={() => submit("link")}
            disabled={sending !== null}
          >
            {sending === "link" ? <Loader2 className="animate-spin" /> : <Link2 className="size-4" />}
            {emailEnabled ? "Copy the link instead" : "Copy the link"}
          </Button>
        )}
      </div>

      {url ? (
        <p className="text-muted-foreground font-mono text-xs break-all">{url}</p>
      ) : null}
    </section>
  );
}
