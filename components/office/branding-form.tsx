"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { ImageIcon } from "lucide-react";

import { DocumentFooter } from "@/components/documents/document-sheet";
import { OfficeDocumentPreview } from "@/components/office/document-preview";
import { SaveStatus, type SaveState } from "@/components/office/save-status";
import { QuoteProjection } from "@/components/quote/projection";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import {
  DOCUMENT_PRESETS,
  lookOf,
  presetOf,
  type DocumentLook,
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
 * **Picking a look saves it.** A click is already a deliberate choice, so
 * there is no second button to forget.
 *
 * **The logo and the band are separate switches.** Either, both, or neither —
 * neither is Plain. The logo is Pro's (Billing §2.2), so without Pro its
 * switch is off and can't be turned on.
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
  const [look, setLook] = useState<DocumentLook>(() => {
    const saved = lookOf(preset);
    return { logo: canSave && saved.logo, bold: saved.bold };
  });
  const [state, setState] = useState<SaveState>("idle");
  const [error, setError] = useState<string | null>(null);

  async function save(next: DocumentLook) {
    setState("saving");
    const body: UpdateOfficeBrandingInput = { documentPreset: presetOf(next) };
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

  function choose(next: DocumentLook) {
    setLook(next);
    if (canSave) void save(next);
  }

  const [plainOption, logoOption, boldOption] = DOCUMENT_PRESETS;
  const plain = !look.logo && !look.bold;

  return (
    <div className="w-full max-w-6xl grid min-w-0 gap-6 @4xl/office:grid-cols-[minmax(0,1fr)_480px]">
      <div className="flex min-w-0 flex-col gap-5">
        {canSave ? (
          <SaveStatus
            state={state}
            error={error}
            onRetry={() => void save(look)}
          />
        ) : (
          <p className="text-muted-foreground text-sm">
            Pro is required to save document branding.
          </p>
        )}

        <div role="group" aria-label="How documents look" className="flex flex-col gap-3">
          <Option
            name={plainOption.name}
            note={plainOption.note}
            reason={plainOption.reason}
            checked={plain}
            onCheckedChange={() => choose({ logo: false, bold: false })}
          />
          <Option
            name={logoOption.name}
            note={logoOption.note}
            reason={canSave ? logoOption.reason : "Your logo goes on documents with Pro."}
            pro={!canSave}
            checked={look.logo}
            disabled={!canSave}
            onCheckedChange={(on) => choose({ ...look, logo: on })}
          />
          <Option
            name={boldOption.name}
            note={boldOption.note}
            reason={boldOption.reason}
            checked={look.bold}
            onCheckedChange={(on) => choose({ ...look, bold: on })}
          />
        </div>

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
          No fonts, no colours, no layout editor. Your logo, a bold band, both or
          neither — each reads cleanly on a phone in a driveway, and that&apos;s
          the whole choice.
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
            // Exactly what goes out: the look as picked, the logo only on Pro.
            logoUrl={logoUrl}
            look={{ logo: canSave && look.logo, bold: look.bold }}
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

/** One switch: a look's name, what it changes, and what it costs. */
function Option({
  name,
  note,
  reason,
  checked,
  disabled = false,
  pro = false,
  onCheckedChange,
}: {
  name: string;
  note: string;
  reason: string;
  checked: boolean;
  disabled?: boolean;
  /** Marks a switch that Pro unlocks. */
  pro?: boolean;
  onCheckedChange: (checked: boolean) => void;
}) {
  return (
    <Label className="hover:bg-muted/50 has-data-[state=checked]:border-ring has-data-[state=checked]:bg-muted/40 has-disabled:hover:bg-transparent has-disabled:cursor-not-allowed has-disabled:opacity-60 flex cursor-pointer items-start gap-3 rounded-lg border p-4 font-normal">
      <Checkbox
        checked={checked}
        disabled={disabled}
        onCheckedChange={(value) => onCheckedChange(value === true)}
        className="mt-0.5"
      />
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-2 font-medium">
          {name}
          {pro ? <Badge variant="secondary">Pro</Badge> : null}
        </span>
        <span className="text-muted-foreground block text-sm">{note}</span>
        <span className="text-muted-foreground mt-1 block text-xs">{reason}</span>
      </span>
    </Label>
  );
}
