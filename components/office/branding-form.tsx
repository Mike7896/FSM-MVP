"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";

import { SaveBar } from "@/components/save-bar";
import { DocumentFooter } from "@/components/documents/document-sheet";
import { OfficeDocumentPreview } from "@/components/office/document-preview";
import { QuoteProjection } from "@/components/quote/projection";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import {
  DOCUMENT_PRESETS,
  normalizePreset,
  type DocumentPreset,
} from "@/lib/branding";
import { emptyDraft } from "@/lib/quote";
import type { OfficeIdentity } from "@/lib/queries/office";
import type { UpdateOfficeBrandingInput } from "@/lib/schemas";

/**
 * An empty quote under the contractor's own header.
 *
 * No invented customer, job or prices: the preview is his business name,
 * license and phone on the document frame, and nothing he didn't write.
 */
const EMPTY_QUOTE = emptyDraft();

/**
 * Screen 42 · document branding · jobs CF1, O2. Wireframe 94 · 34c.
 *
 * **The preview is the point of the screen.** This is a decision about *her*
 * experience, so her screen sits permanently on the right and the choice
 * becomes obvious rather than imagined. It is the real share surface — the same
 * component the homeowner's page renders — not a mockup of one, which is what
 * stops the preview drifting from the thing it previews.
 *
 * **Presets gain a reason each, including the cost of the expensive one.** A
 * preset list without trade-offs is a taste quiz.
 *
 * **Still no design tool.** Three options and a logo slot, said at the size
 * where a font picker would be easiest to add.
 */
export function BrandingForm({
  preset,
  identity,
  logoUrl,
  canSave = true,
}: {
  preset: string | null;
  /** What the header actually carries today — business name, license, phone. */
  identity: OfficeIdentity;
  logoUrl: string | null;
  canSave?: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const initial = normalizePreset(preset);
  const [selected, setSelected] = useState<DocumentPreset>(initial);

  const dirty = selected !== initial;
  const selectedName = DOCUMENT_PRESETS.find(
    (option) => option.id === selected
  )!.name;

  function save(event: React.FormEvent) {
    event.preventDefault();
    if (!canSave) return;
    startTransition(async () => {
      const body: UpdateOfficeBrandingInput = { documentPreset: selected };
      const response = await fetch("/api/v1/office/branding", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      if (!response.ok) {
        const parsed = (await response.json().catch(() => null)) as {
          error?: { message?: string };
        } | null;
        toast.error(parsed?.error?.message ?? "Couldn't save. Try again.");
        return;
      }

      toast.success("Saved. New documents go out looking like this.");
      router.refresh();
    });
  }

  return (
    <form onSubmit={save} className="w-full max-w-6xl grid min-w-0 gap-6 @4xl/office:grid-cols-[minmax(0,1fr)_480px]">
      <div className="flex min-w-0 flex-col gap-5">
        <RadioGroup
          value={selected}
          onValueChange={(value) => setSelected(value as DocumentPreset)}
          className="gap-3"
        >
          {DOCUMENT_PRESETS.map((option) => (
            <Label
              key={option.id}
              className="hover:bg-muted/50 flex cursor-pointer items-start gap-3 rounded-lg border p-4 font-normal"
            >
              <RadioGroupItem value={option.id} className="mt-0.5" />
              <span className="min-w-0 flex-1">
                <span className="block font-medium">{option.name}</span>
                <span className="text-muted-foreground block text-sm">
                  {option.note}
                </span>
                <span className="text-muted-foreground mt-1 block text-xs">
                  {option.reason}
                </span>
              </span>
            </Label>
          ))}
        </RadioGroup>

        {/* The logo lives on business identity and is shown here because two of
            the three presets depend on there being one. Linking rather than
            duplicating keeps one place to change it. */}
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border px-5 py-3.5">
          <div className="min-w-0">
            <p className="text-sm font-medium">Your logo</p>
            <p className="text-muted-foreground truncate text-xs">
              {logoUrl ?? "None yet — Plain is the one that doesn't need it"}
            </p>
          </div>
          <Link
            href="/office"
            className="text-primary-ink text-sm underline underline-offset-4"
          >
            {logoUrl ? "Replace" : "Add one"}
          </Link>
        </div>

        <p className="text-muted-foreground text-sm">
          No fonts, no colours, no layout editor. Three looks that all read
          cleanly on a phone in a driveway — that&apos;s the whole choice.
        </p>

        <p className="text-muted-foreground rounded-lg border border-dashed p-5 text-sm">
          Light or dark for <strong className="text-foreground">your own</strong>{" "}
          screens is a different decision, and it lives in{" "}
          <Link
            href="/settings#appearance"
            className="text-primary-ink underline underline-offset-4"
          >
            Settings → Appearance
          </Link>
          .
        </p>

        {canSave ? <SaveBar
          dirty={dirty}
          pending={pending}
          label={`Use ${selectedName}`}
          note={
            dirty
              ? "Applies to documents from here on. Anything already sent keeps the look it went out with."
              : undefined
          }
        /> : <p className="text-muted-foreground text-sm">Pro is required to save document branding.</p>}
      </div>

      <div className="flex min-w-0 flex-col gap-2 @4xl/office:sticky @4xl/office:top-22 @4xl/office:self-start">
        <p className="text-muted-foreground font-label text-[10px] uppercase">
          What your customer sees
        </p>
        <OfficeDocumentPreview
          footer={<DocumentFooter businessName={identity.businessName} />}
        >
          <QuoteProjection
            draft={EMPTY_QUOTE}
            businessName={identity.businessName}
            license={identity.license}
            phone={identity.phone}
            action={null}
          />
        </OfficeDocumentPreview>
        <p className="text-muted-foreground text-xs">
          Updates as you pick. This is the real share surface, not a mockup of
          it.
        </p>
      </div>
    </form>
  );
}
