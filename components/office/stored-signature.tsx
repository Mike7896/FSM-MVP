"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, PenLine } from "lucide-react";
import { toast } from "sonner";

import { SignatureMark } from "@/components/signing/signature-mark";
import { SignaturePad } from "@/components/signing/signature-pad";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { apiJson } from "@/lib/api/client";
import { cn } from "@/lib/utils";

type Stored = {
  printedName: string | null;
  mark: string | null;
  autoSign: boolean;
};

/**
 * The business's signature — Documents §5.
 *
 * **Adopted once, here, so the customer can finish tonight.** It goes on the
 * business's line of every quote that carries signature lines, which is what
 * lets the customer accept by signing the quote itself; and on every contract
 * generated from an approved quote. Without one, the customer approves with a
 * button and the contract waits for the business to sign it from the job.
 *
 * It saves on its own rather than with the defaults above it: a signature is an
 * act, not a starting number, and it should never ride along with a tax rate.
 *
 * Mounted in two places — the Defaults page, and a dialog in the quote editor's
 * Acceptance section — so `onChange` tells a host that is holding its own copy
 * what the Office now keeps.
 */
export function StoredSignature({
  stored,
  personName,
  onChange,
  bare = false,
}: {
  stored: Stored;
  personName: string | null;
  /** Called with the signature as saved, or null once it's removed. */
  onChange?: (next: { printedName: string; mark: string; autoSign: boolean } | null) => void;
  /** Inside a dialog that already has a title and a frame. */
  bare?: boolean;
}) {
  const router = useRouter();

  const [editing, setEditing] = useState(stored.mark === null);
  const [mode, setMode] = useState<"type" | "draw">("type");
  const [name, setName] = useState(stored.printedName ?? personName ?? "");
  const [paths, setPaths] = useState<string[]>([]);
  const [autoSign, setAutoSign] = useState(stored.autoSign);
  const [pending, setPending] = useState(false);

  const hasMark = mode === "draw" ? paths.length > 0 : name.trim().length > 0;
  const ready = name.trim().length > 0 && hasMark && !pending;

  function report(saved: Stored) {
    onChange?.(
      saved.mark && saved.printedName
        ? { printedName: saved.printedName, mark: saved.mark, autoSign: saved.autoSign }
        : null
    );
  }

  async function save() {
    if (!ready) return;
    setPending(true);

    try {
      const saved = await apiJson<Stored>("/api/v1/office/signature", "PUT", {
        printedName: name.trim(),
        mark: mode === "draw" ? { kind: "drawn", paths } : { kind: "typed" },
        autoSign,
      });
      toast.success("Saved. Your quotes and contracts will carry this signature.");
      setEditing(false);
      report(saved);
      router.refresh();
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Your signature didn't save."
      );
    } finally {
      setPending(false);
    }
  }

  async function changeAutoSign(next: boolean) {
    setAutoSign(next);
    // Before a signature exists this is only part of what Save will send.
    if (stored.mark === null) return;

    try {
      const saved = await apiJson<Stored>("/api/v1/office/signature", "PATCH", {
        autoSign: next,
      });
      toast.success(
        next
          ? "Your signature will be applied for you."
          : "Your signature won't be applied until you sign by hand."
      );
      report(saved);
      router.refresh();
    } catch (error) {
      setAutoSign(!next);
      toast.error(
        error instanceof Error ? error.message : "That didn't save. Try again."
      );
    }
  }

  async function remove() {
    setPending(true);

    try {
      const response = await fetch("/api/v1/office/signature", {
        method: "DELETE",
      });
      if (!response.ok) throw new Error("Your signature wasn't removed. Try again.");
      toast.success("Removed. Nothing will be signed for you now.");
      setPaths([]);
      setEditing(true);
      onChange?.(null);
      router.refresh();
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Your signature wasn't removed."
      );
    } finally {
      setPending(false);
    }
  }

  return (
    <section
      id="signature"
      className={cn(
        "flex scroll-mt-20 flex-col gap-5",
        !bare && "rounded-xl border p-5"
      )}
    >
      {bare ? null : (
        <div>
          <p className="text-muted-foreground font-label text-[11px] uppercase">
            Your signature
          </p>
          <p className="text-muted-foreground mt-1.5 text-xs leading-relaxed">
            It goes on the business&apos;s signature line of your quotes and
            contracts — so a customer can sign and pay the deposit right then,
            without waiting on you.
          </p>
        </div>
      )}

      {!editing && stored.mark ? (
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div className="min-w-0">
            <SignatureMark
              value={stored.mark}
              className="h-auto min-h-12 w-auto max-w-full text-3xl"
            />
            <p className="text-muted-foreground mt-1 text-xs">
              {stored.printedName}
            </p>
          </div>
          <div className="flex gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setEditing(true)}
              disabled={pending}
            >
              Replace
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={remove}
              disabled={pending}
            >
              Remove
            </Button>
          </div>
        </div>
      ) : (
        <div className="flex flex-col gap-4">
          <div className="grid gap-2">
            <Label htmlFor="stored-signature-name">Name under the signature</Label>
            <Input
              id="stored-signature-name"
              value={name}
              onChange={(event) => setName(event.target.value)}
              autoComplete="name"
              disabled={pending}
            />
          </div>

          <Tabs
            value={mode}
            onValueChange={(value) => setMode(value as "type" | "draw")}
          >
            <TabsList>
              <TabsTrigger value="type">Type</TabsTrigger>
              <TabsTrigger value="draw">Draw</TabsTrigger>
            </TabsList>
            <TabsContent value="type" className="mt-3">
              <div className="bg-background flex min-h-[120px] min-w-0 items-center justify-center rounded-lg border p-3">
                {name.trim() ? (
                  <SignatureMark value={`typed:${name.trim()}`} className="max-w-full text-center text-3xl [overflow-wrap:anywhere]" />
                ) : (
                  <span className="text-muted-foreground text-xs">
                    Type your name above to see it
                  </span>
                )}
              </div>
            </TabsContent>
            <TabsContent value="draw" className="mt-3">
              <SignaturePad onChange={setPaths} disabled={pending} />
            </TabsContent>
          </Tabs>

          <p className="text-muted-foreground text-xs">
            Saving adopts this as the business&apos;s signature on its quotes and
            contracts.
          </p>

          <div className="flex flex-wrap items-center gap-2">
            <Button type="button" onClick={save} disabled={!ready}>
              {pending ? (
                <Loader2 className="animate-spin" />
              ) : (
                <PenLine className="size-4" />
              )}
              Save signature
            </Button>
            {stored.mark ? (
              <Button
                type="button"
                variant="ghost"
                onClick={() => setEditing(false)}
                disabled={pending}
              >
                Cancel
              </Button>
            ) : null}
          </div>
        </div>
      )}

      <div className="flex items-start justify-between gap-4 border-t pt-4">
        <div>
          <Label htmlFor="auto-sign" className="font-normal">
            Apply my signature automatically
          </Label>
          <p className="text-muted-foreground mt-1 text-xs leading-relaxed">
            Off, nothing is signed for you: customers approve quotes with a
            button, and each contract waits for you to sign it from the job.
          </p>
        </div>
        <Switch
          id="auto-sign"
          checked={autoSign}
          onCheckedChange={changeAutoSign}
          disabled={pending}
        />
      </div>
    </section>
  );
}
