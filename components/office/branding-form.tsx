"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { ImageIcon } from "lucide-react";

import { DocumentFooter } from "@/components/documents/document-sheet";
import { OfficeDocumentPreview } from "@/components/office/document-preview";
import { SaveStatus, type SaveState } from "@/components/office/save-status";
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
 * experience, so her screen sits permanently on the right. It is the real
 * share surface — the same component the homeowner's page renders.
 *
 * **Picking a look saves it.** A click on one of three options is already a
 * deliberate choice, so there is no second button to forget.
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
  const [selected, setSelected] = useState<DocumentPreset>(
    normalizePreset(preset)
  );
  const [state, setState] = useState<SaveState>("idle");
  const [error, setError] = useState<string | null>(null);

  async function save(next: DocumentPreset) {
    setState("saving");
    const body: UpdateOfficeBrandingInput = { documentPreset: next };
    const response = await fetch("/api/v1/office/branding", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }).catch(() => null);

    if (!response?.ok) {
      const parsed = (await response?.json().catch(() => null)) as {
        error?: { message?: string };
      } | null;
      setError(parsed?.error?.message ?? "Couldn't save.");
      setState("error");
      return;
    }

    setState("saved");
    router.refresh();
  }

  function choose(next: DocumentPreset) {
    setSelected(next);
    if (canSave) void save(next);
  }

  return (
    <div className="w-full max-w-6xl grid min-w-0 gap-6 @4xl/office:grid-cols-[minmax(0,1fr)_480px]">
      <div className="flex min-w-0 flex-col gap-5">
        {canSave ? (
          <SaveStatus
            state={state}
            error={error}
            onRetry={() => void save(selected)}
          />
        ) : (
          <p className="text-muted-foreground text-sm">
            Pro is required to save document branding.
          </p>
        )}

        <RadioGroup
          value={selected}
          onValueChange={(value) => choose(value as DocumentPreset)}
          className="gap-3"
        >
          {DOCUMENT_PRESETS.map((option) => (
            <Label
              key={option.id}
              className="hover:bg-muted/50 has-data-[state=checked]:border-ring has-data-[state=checked]:bg-muted/40 flex cursor-pointer items-start gap-3 rounded-lg border p-4 font-normal"
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
            the three presets depend on there being one. */}
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border px-4 py-3">
          <div className="flex min-w-0 items-center gap-3">
            <div className="bg-muted/40 flex h-10 w-20 shrink-0 items-center justify-center overflow-hidden rounded-md border">
              {logoUrl ? (
                // eslint-disable-next-line @next/next/no-img-element -- the business's own uploaded image, any size
                <img
                  src={logoUrl}
                  alt="Your logo"
                  className="max-h-full max-w-full object-contain p-1"
                />
              ) : (
                <ImageIcon className="text-muted-foreground size-4" />
              )}
            </div>
            <div className="min-w-0">
              <p className="text-sm font-medium">Your logo</p>
              <p className="text-muted-foreground text-xs">
                {logoUrl
                  ? "Uploaded on Business identity"
                  : "None yet — Plain is the one that doesn't need it"}
              </p>
            </div>
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
            // Pro puts the logo on documents; the preview shows what's sent.
            logoUrl={canSave ? logoUrl : null}
            action={null}
          />
        </OfficeDocumentPreview>
        <p className="text-muted-foreground text-xs">
          Updates as you pick. This is the real share surface, not a mockup of
          it.
        </p>
      </div>
    </div>
  );
}
