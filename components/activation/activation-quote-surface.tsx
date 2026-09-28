"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Compass } from "lucide-react";

import {
  QuoteEditor,
  type QuoteEditorController,
} from "@/components/quote-editor";
import type { SendContext } from "@/components/quote-editor/surfaces";
import { SendFlow, type SenderOffice } from "@/components/quote-send/send-flow";
import { useTours } from "@/components/tours/context";
import { Button } from "@/components/ui/button";
import {
  draftFromSeed,
  emptyDraft,
  parseSeed,
  type QuoteDraft,
} from "@/lib/quote";

/**
 * Activation — **the ordinary quote editor, plus the things that are genuinely
 * different about a contractor's first one.**
 *
 * There is no activation editor, and no activation send. What is left here is
 * only what onboarding actually adds:
 *
 * 1. **The Office may not exist yet.** So autosave is held until it does. The
 *    contractor builds a real quote against an Office that has not been
 *    created — Journey 0's whole premise, and the reason this route lives
 *    outside the app shell. The Office introduction creates it, from the gap in
 *    his own letterhead, and the quote is written the moment it exists.
 * 2. **It may be a demo** (14a). A blank quote, the chip, and a send that can
 *    only reach his own address — the flag rides every object it creates.
 * 3. **The onboarding tour**, which the tour system in the layout runs over
 *    this page. All this surface adds is "Show me around" to replay it.
 *
 * Everything else — the sections, the totals, the terms, the preview, the send
 * — is the same code the app uses, on purpose.
 */
export function ActivationQuoteSurface({
  seedText,
  demo,
  office: initialOffice,
  hasOrganization,
  send,
}: {
  /** The sentence from the real start. The demo start has none. */
  seedText?: string;
  demo: boolean;
  office: SenderOffice;
  hasOrganization: boolean;
  send: SendContext;
}) {
  const router = useRouter();
  const { start: startTour } = useTours();

  // The sentence names the customer and the job, and nothing else. A demo is a
  // blank practice quote — nothing is filled in for him either way.
  const [initial] = useState<QuoteDraft>(() =>
    seedText ? draftFromSeed(parseSeed(seedText)) : emptyDraft()
  );

  const editor = useRef<QuoteEditorController>(null);
  const [office, setOffice] = useState(initialOffice);
  // Flipping this true re-arms the editor's autosave, which then writes the
  // whole draft — including everything typed before the Office existed.
  const [canSave, setCanSave] = useState(hasOrganization);
  const [preview, setPreview] = useState<QuoteDraft | null>(null);

  return (
    /**
     * **Class W, and it fills the frame.** Journey 0 runs in a browser, so the
     * two frames a contractor actually meets during activation are the desk
     * browser and the phone browser (13a/13b) — not a phone column parked in
     * the middle of a desktop. Under the wordmark bar the editor gets the whole
     * page, and its own container queries pick which frame to wear.
     */
    <div className="flex min-h-0 flex-1 flex-col">
      <QuoteEditor
        initial={initial}
        office={office}
        onOfficeChange={setOffice}
        autosave={canSave}
        demo={demo}
        controllerRef={editor}
        onBack={() => router.push("/welcome")}
        onPreview={setPreview}
        previewLabel="Preview it"
        headerActions={
          <Button
            variant="ghost"
            size="sm"
            onClick={() => startTour("onboarding")}
            aria-label="Show me around"
            className="text-muted-foreground"
          >
            <Compass />
            <span className="hidden @md:inline">Show me around</span>
          </Button>
        }
      />

      <SendFlow
        editor={editor}
        preview={preview}
        onClosePreview={() => setPreview(null)}
        office={office}
        onOfficeChange={setOffice}
        hasOrganization={canSave}
        onOrganizationReady={() => setCanSave(true)}
        demo={demo}
        {...send}
        sentHref={(quoteId) => `/welcome/sent/${quoteId}`}
      />
    </div>
  );
}
