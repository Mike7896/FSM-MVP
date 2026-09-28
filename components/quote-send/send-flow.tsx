"use client";

import { useState, type RefObject } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

import type { QuoteEditorController } from "@/components/quote-editor";
import {
  OfficeIntro,
  type HeaderSlice,
  type IntroReason,
} from "@/components/quote-send/office-intro";
import { QuotePreviewSheet } from "@/components/quote-send/preview-sheet";
import { QuoteSendSheet } from "@/components/quote-send/send-sheet";
import { totals, type QuoteDraft } from "@/lib/quote";
import type { OfficeSignature } from "@/lib/signing/lines";

/**
 * Preview → the Office, when the letterhead has gaps → send → where it stands.
 *
 * **One path out of every editor.** The first quote in activation, a new quote
 * at the desk and an old one reopened all leave the same way, so the gate, the
 * send and the confirmation cannot drift between them. What differs is passed
 * in: whether the Office exists yet, whether this is a demo, and where the
 * confirmation lives.
 *
 * The draft is flushed through the editor before the send opens, because the
 * send needs the quote's row — and on a first quote the row can only be written
 * once the Office exists, which may be the step that just happened.
 */

export type SenderOffice = {
  businessName: string | null;
  license: string | null;
  phone: string | null;
  logoUrl?: string | null;
  /** The adopted signature, for the lines at the foot of the preview. */
  signature?: OfficeSignature | null;
};

export function SendFlow({
  editor,
  preview,
  onClosePreview,
  office,
  onOfficeChange,
  hasOrganization,
  onOrganizationReady,
  demo,
  emailEnabled,
  selfEmail,
  selfPhone,
  customerEmail,
  sentHref,
}: {
  editor: RefObject<QuoteEditorController | null>;
  /** The draft being previewed, or null when the preview is closed. */
  preview: QuoteDraft | null;
  onClosePreview: () => void;
  office: SenderOffice;
  onOfficeChange: (office: SenderOffice) => void;
  hasOrganization: boolean;
  /** The Office exists now — the moment activation can start saving. */
  onOrganizationReady?: () => void;
  demo: boolean;
  emailEnabled: boolean;
  selfEmail: string;
  selfPhone: string | null;
  customerEmail: string | null;
  /** Where a sent quote's confirmation lives. */
  sentHref: (quoteId: string) => string;
}) {
  const router = useRouter();
  const [intro, setIntro] = useState<IntroReason | null>(null);
  const [sending, setSending] = useState<QuoteDraft | null>(null);
  const [preparing, setPreparing] = useState(false);

  const gaps = !office.businessName || !office.license;

  /** Flush the draft, then open the send on the row that was written. */
  async function openSend(draft: QuoteDraft) {
    setPreparing(true);
    try {
      const saved = await editor.current?.saveNow();
      const id = saved?.id ?? null;
      if (!id) {
        toast.error("Couldn't save the quote, so it can't go out yet. Try again.");
        return;
      }
      setSending({ ...draft, id, number: saved?.number ?? draft.number });
      onClosePreview();
    } finally {
      setPreparing(false);
    }
  }

  function requestSend() {
    if (!preview) return;
    // Send stays live with gaps in the letterhead. It opens the fill — the
    // second and last time he is asked — rather than refusing.
    if (gaps) {
      setIntro("send");
      return;
    }
    void openSend(preview);
  }

  async function saved(slice: HeaderSlice) {
    onOfficeChange({ ...office, ...slice });
    onOrganizationReady?.();
    const reason = intro;
    setIntro(null);
    // Asked to send: the button finishes the send he asked for.
    if (reason === "send" && preview) await openSend(preview);
  }

  return (
    <>
      <QuotePreviewSheet
        open={preview !== null && intro === null}
        onOpenChange={(open) => {
          if (!open) onClosePreview();
        }}
        draft={preview ?? emptyPreview}
        office={office}
        demo={demo}
        preparing={preparing}
        onFillHeader={() => setIntro("gap")}
        onSend={requestSend}
      />

      {intro && preview ? (
        <OfficeIntro
          open
          onOpenChange={(open) => {
            // Dismissed: back to the preview with the gaps still showing.
            if (!open) setIntro(null);
          }}
          reason={intro}
          customerName={preview.customerName}
          businessName={office.businessName}
          license={office.license}
          contact={selfPhone ?? selfEmail}
          phone={selfPhone}
          hasOrganization={hasOrganization}
          demo={demo}
          onSaved={saved}
        />
      ) : null}

      {sending?.id ? (
        <QuoteSendSheet
          open
          onOpenChange={(open) => {
            if (!open) setSending(null);
          }}
          quoteId={sending.id}
          customerName={sending.customerName}
          title={sending.title}
          totalCents={totals(sending).totalCents}
          demo={demo}
          emailEnabled={emailEnabled}
          customerEmail={customerEmail}
          selfEmail={selfEmail}
          onSent={() => router.push(sentHref(sending.id!))}
        />
      ) : null}
    </>
  );
}

/**
 * What the closed preview holds between openings — never shown, but the
 * dialog stays mounted so it can animate, and it needs a draft to hold.
 */
const emptyPreview: QuoteDraft = {
  id: null,
  number: null,
  jobId: null,
  customerId: null,
  customerName: "",
  title: "",
  scopeOfWork: "",
  scope: [],
  taxRate: null,
  terms: {
    contractType: null,
    priceStructure: null,
    pricingMethod: null,
    estimatingMethod: null,
    estimateClass: null,
    billingTrigger: null,
    moneyUpFront: null,
    depositPercent: null,
    progressBilling: null,
    retainagePercent: null,
    capCents: null,
  },
  status: "draft",
  licenseId: null,
  packId: null,
  signatureLines: true,
};
