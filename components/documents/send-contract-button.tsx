"use client";

import { reportFreeLimit } from "@/lib/membership/limit-event";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Link2, Loader2, Mail, Send } from "lucide-react";
import { toast } from "sonner";

import {
  ResponsiveDialog,
  ResponsiveDialogBody,
  ResponsiveDialogContent,
  ResponsiveDialogFooter,
  ResponsiveDialogHeader,
} from "@/components/responsive-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

type SendResult = { url: string; channel: "email" | "link"; to: string | null };

/**
 * Send a copy of the contract — the button on the contract page.
 *
 * **The same link it was always on.** A copy is a copy: the customer opens the
 * page they were already sent, signs there if they haven't, and a signature on
 * yesterday's email and today's are the same signature.
 *
 * **Email first, like every document.** It goes through the product in the
 * business's name; copying the link is the fallback for passing it on by hand,
 * and becomes the main action only where email isn't set up.
 */
export function SendContractButton({
  contractId,
  customerName,
  customerEmail,
  emailEnabled,
  signed,
}: {
  contractId: string;
  customerName: string;
  /** The address already on the customer, if there is one. */
  customerEmail: string | null;
  /** Whether this deployment can send email at all. */
  emailEnabled: boolean;
  /** Both parties have signed, so this is a copy for their records. */
  signed: boolean;
}) {
  const router = useRouter();
  const firstName = customerName.trim().split(/\s+/)[0] || "";
  const [open, setOpen] = useState(false);
  const [to, setTo] = useState(customerEmail ?? "");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState<"email" | "link" | null>(null);
  const [error, setError] = useState<string | null>(null);

  const addressOk = /^\S+@\S+\.\S+$/.test(to.trim());

  async function send(channel: "email" | "link") {
    setBusy(channel);
    setError(null);

    const response = await fetch(`/api/v1/contracts/${contractId}/send`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        channel,
        ...(message.trim() ? { message: message.trim() } : {}),
        ...(channel === "email" ? { to: to.trim() } : {}),
      }),
    }).catch(() => null);

    const body = (await response?.json().catch(() => null)) as {
      data?: SendResult;
      error?: { message?: string };
    } | null;

    if (!response?.ok || !body?.data) {
      // At the Free job limit the upgrade sheet opens over the draft (§3.1).
      reportFreeLimit(body?.error);
      // The sheet keeps what he typed, with one line saying what happened.
      setError(
        body?.error?.message ??
          "Couldn't reach the server. Nothing was sent — try again."
      );
      setBusy(null);
      return;
    }

    if (channel === "link") {
      try {
        await navigator.clipboard.writeText(body.data.url);
        toast.success(
          `Link copied — ready to send${firstName ? ` to ${firstName}` : ""}.`
        );
      } catch {
        toast.message("Your link is ready", { description: body.data.url });
      }
    } else {
      toast.success(`Emailed to ${body.data.to}.`);
    }

    setBusy(null);
    setOpen(false);
    // The send is now in the document's history, which this page shows.
    router.refresh();
  }

  return (
    <>
      <Button variant="outline" onClick={() => setOpen(true)}>
        <Send />
        Send a copy
      </Button>

      <ResponsiveDialog
        open={open}
        onOpenChange={(next) => {
          if (busy === null) setOpen(next);
        }}
      >
        <ResponsiveDialogContent desktopClassName="sm:max-w-md">
          <ResponsiveDialogHeader
            title={firstName ? `Email a copy to ${firstName}` : "Email a copy"}
            description={
              signed
                ? "The signed contract, on the same link it was signed on."
                : "The same link it can be read and signed on."
            }
          />

          <ResponsiveDialogBody className="flex flex-col gap-5">
            {emailEnabled ? null : (
              <p className="bg-muted/50 rounded-lg border p-3 text-sm leading-relaxed">
                Email isn&apos;t set up yet, so this can&apos;t be sent from
                here. You can copy the link and send it yourself for now.
              </p>
            )}

            <div className="grid gap-1.5">
              <Label htmlFor="contract-to">To</Label>
              <Input
                id="contract-to"
                type="email"
                value={to}
                onChange={(event) => setTo(event.target.value)}
                autoComplete="off"
                disabled={!emailEnabled}
              />
              {customerEmail ? null : (
                <p className="text-muted-foreground text-xs">
                  We don&apos;t have an address for {firstName || "them"} yet.
                  What you type here is kept on their record.
                </p>
              )}
            </div>

            <div className="grid gap-1.5">
              <Label htmlFor="contract-message">
                Message{" "}
                <span className="text-muted-foreground font-normal">
                  (optional)
                </span>
              </Label>
              <Textarea
                id="contract-message"
                rows={3}
                value={message}
                maxLength={2000}
                className="min-h-24 resize-none"
                onChange={(event) => setMessage(event.target.value)}
              />
              <p className="text-muted-foreground text-xs">
                Left blank, it says hello and what the link is for. The
                contract&apos;s card and link go underneath either way.
              </p>
            </div>

            {error ? (
              <p role="alert" className="text-destructive text-sm">
                {error}
              </p>
            ) : null}
          </ResponsiveDialogBody>

          <ResponsiveDialogFooter className="flex flex-wrap items-center justify-between gap-2">
            <Button
              variant={emailEnabled ? "ghost" : "default"}
              size={emailEnabled ? "sm" : "default"}
              className={emailEnabled ? "text-muted-foreground" : undefined}
              disabled={busy !== null}
              onClick={() => send("link")}
            >
              {busy === "link" ? <Loader2 className="animate-spin" /> : <Link2 />}
              {emailEnabled ? "Copy the link instead" : "Copy the link"}
            </Button>
            {emailEnabled ? (
              <Button
                disabled={busy !== null || !addressOk}
                onClick={() => send("email")}
              >
                {busy === "email" ? <Loader2 className="animate-spin" /> : <Mail />}
                Send email
              </Button>
            ) : null}
          </ResponsiveDialogFooter>
        </ResponsiveDialogContent>
      </ResponsiveDialog>
    </>
  );
}
