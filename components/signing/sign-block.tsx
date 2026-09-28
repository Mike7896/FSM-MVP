"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, PenLine } from "lucide-react";
import { toast } from "sonner";

import { SignaturePad } from "@/components/signing/signature-pad";
import { ConsentNotice } from "@/components/signing/consent-notice";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

/**
 * THE SIGNING BLOCK — one component, both parties, both surfaces.
 *
 * The contractor signs it from inside the app; the homeowner signs the same
 * block from a share link with no account. **Continuity is the trust
 * mechanism**: she has already approved a quote through this shape, so the
 * contract feels like the next step rather than a new system asking for
 * something.
 *
 * ## Why two ways to sign
 *
 * Typing a name is a signature under ESIGN and it is what most people do on a
 * phone. Drawing is what people *expect* a signature to be, and refusing them
 * the option reads as cheap. Neither is faked as the other — the record stores
 * which one happened, because they are not the same evidence.
 *
 * ## What this component deliberately does not do
 *
 * It does not compute the time, the IP or the hash. Every one of those is
 * captured on the server from the request itself, because a browser can claim
 * any of them, and an audit trail assembled from a client's claims is not one.
 * All this sends is a name, a mark, and the fact that the box was ticked.
 */
export function SignBlock({
  /** Where to POST. `/api/v1/documents/<id>/sign`, or the share-token route. */
  endpoint,
  party,
  /** Prefilled from the header snapshot — she should not retype her own name. */
  defaultName,
  businessName,
  /** What the button says. "Sign and send it back" reads better than "Submit". */
  actionLabel = "Sign",
  heading = "Your signature",
  description = "Draw it, or type your name — both count as a signature.",
  onSigned,
  bare = false,
}: {
  endpoint: string;
  party: "contractor" | "customer";
  defaultName?: string | null;
  businessName?: string | null;
  actionLabel?: string;
  /** What the block is for, where "Your signature" undersells it. */
  heading?: string;
  description?: string;
  /** Called with the endpoint's `data` — the share route's includes where to go next. */
  onSigned?: (result: unknown) => void;
  /**
   * Without its own card — for a panel that already is one, like the space
   * under the page on the customer's link.
   */
  bare?: boolean;
}) {
  const router = useRouter();

  const [mode, setMode] = useState<"draw" | "type">("draw");
  const [name, setName] = useState(defaultName ?? "");
  const [paths, setPaths] = useState<string[]>([]);
  const [consented, setConsented] = useState(false);
  const [pending, setPending] = useState(false);

  const hasMark = mode === "draw" ? paths.length > 0 : name.trim().length > 0;
  const ready = consented && name.trim().length > 0 && hasMark && !pending;

  async function submit() {
    if (!ready) return;
    setPending(true);

    try {
      const response = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          party,
          printedName: name.trim(),
          consented,
          mark: mode === "draw" ? { kind: "drawn", paths } : { kind: "typed" },
        }),
      });

      const body = (await response.json().catch(() => null)) as {
        data?: unknown;
        error?: { message?: string };
      } | null;

      if (!response.ok) {
        toast.error(body?.error?.message ?? "That signature didn't save.");
        return;
      }

      toast.success("Signed.");
      onSigned?.(body?.data ?? null);
      router.refresh();
    } finally {
      setPending(false);
    }
  }

  return (
    <div className={bare ? "flex flex-col gap-4" : "flex flex-col gap-4 rounded-xl border p-5"}>
      <div>
        <p className={bare ? "text-base font-semibold" : "font-label text-[11px] uppercase"}>
          {heading}
        </p>
        <p className="text-muted-foreground mt-1 text-sm">{description}</p>
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="signer-name">Full name</Label>
        <Input
          id="signer-name"
          value={name}
          onChange={(event) => setName(event.target.value)}
          placeholder="First and last name"
          autoComplete="name"
          disabled={pending}
        />
      </div>

      <Tabs value={mode} onValueChange={(value) => setMode(value as "draw" | "type")}>
        <TabsList className="w-full">
          <TabsTrigger value="draw" className="flex-1">
            Draw
          </TabsTrigger>
          <TabsTrigger value="type" className="flex-1">
            Type
          </TabsTrigger>
        </TabsList>

        <TabsContent value="draw" className="mt-3">
          <SignaturePad onChange={setPaths} disabled={pending} />
        </TabsContent>

        <TabsContent value="type" className="mt-3">
          <div className="bg-background flex h-[120px] items-center justify-center rounded-lg border">
            {name.trim() ? (
              <span
                className="text-3xl"
                style={{
                  fontFamily:
                    '"Segoe Script", "Brush Script MT", "Snell Roundhand", cursive',
                }}
              >
                {name.trim()}
              </span>
            ) : (
              <span className="text-muted-foreground text-xs">
                Type your name above to see it
              </span>
            )}
          </div>
        </TabsContent>
      </Tabs>

      <ConsentNotice
        checked={consented}
        onCheckedChange={setConsented}
        businessName={businessName}
        disabled={pending}
      />

      <Button onClick={submit} disabled={!ready} size="lg">
        {pending ? (
          <Loader2 className="animate-spin" />
        ) : (
          <PenLine className="size-4" />
        )}
        {actionLabel}
      </Button>
    </div>
  );
}
