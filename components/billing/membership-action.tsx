"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";

import {
  ResponsiveDialog,
  ResponsiveDialogBody,
  ResponsiveDialogContent,
  ResponsiveDialogHeader,
} from "@/components/responsive-dialog";
import { Button } from "@/components/ui/button";

/**
 * One membership action — resume, keep the current plan, cancel, refund,
 * start an evaluation, open the portal. Posts to its endpoint and refreshes.
 *
 * Anything with a consequence asks first, in a dialog that says what will
 * happen in plain words, and the confirm button names the action rather than
 * saying "OK".
 */
export function MembershipAction({
  endpoint,
  label,
  success,
  confirm,
  variant = "outline",
  size = "sm",
  body,
  redirectToUrl = false,
}: {
  endpoint: string;
  label: string;
  success?: string;
  confirm?: { title: string; lines: string[]; action: string; destructive?: boolean };
  variant?: React.ComponentProps<typeof Button>["variant"];
  size?: React.ComponentProps<typeof Button>["size"];
  body?: unknown;
  /** The endpoint answers `{ url }` to go to — the Stripe portal. */
  redirectToUrl?: boolean;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);

  async function run() {
    setPending(true);
    try {
      const response = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body ?? {}),
      });
      const payload = (await response.json().catch(() => null)) as {
        data?: { url?: string };
        error?: { message?: string };
      } | null;
      if (!response.ok) throw new Error(payload?.error?.message ?? "That didn't work. Nothing changed.");
      if (redirectToUrl && payload?.data?.url) {
        window.location.href = payload.data.url;
        return;
      }
      if (success) toast.success(success);
      setOpen(false);
      router.refresh();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "That didn't work. Nothing changed.");
    } finally {
      setPending(false);
    }
  }

  return (
    <>
      <Button
        variant={variant}
        size={size}
        disabled={pending}
        onClick={() => (confirm ? setOpen(true) : run())}
      >
        {pending && !confirm ? <Loader2 className="animate-spin" /> : null}
        {label}
      </Button>
      {confirm ? (
        <ResponsiveDialog open={open} onOpenChange={setOpen}>
          <ResponsiveDialogContent desktopClassName="sm:max-w-md">
            <ResponsiveDialogHeader title={confirm.title} />
            <ResponsiveDialogBody>
              <ul className="flex flex-col gap-2 text-sm">
                {confirm.lines.map((line) => (
                  <li key={line} className="leading-relaxed">{line}</li>
                ))}
              </ul>
              <div className="mt-5 flex flex-wrap justify-end gap-2">
                <Button variant="ghost" onClick={() => setOpen(false)} disabled={pending}>
                  Go back
                </Button>
                <Button
                  variant={confirm.destructive ? "destructive" : "default"}
                  onClick={run}
                  disabled={pending}
                >
                  {pending ? <Loader2 className="animate-spin" /> : null}
                  {confirm.action}
                </Button>
              </div>
            </ResponsiveDialogBody>
          </ResponsiveDialogContent>
        </ResponsiveDialog>
      ) : null}
    </>
  );
}
