"use client";

import { useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";

import {
  QuoteEditor,
  type QuoteEditorController,
} from "@/components/quote-editor";
import { DocumentModeSwitch, StandingLink } from "@/components/documents/mode-switch";
import { SendFlow, type SenderOffice } from "@/components/quote-send/send-flow";
import type { CaptureItem } from "@/lib/queries/captures";
import {
  applyOfficeDefaults,
  draftFromRecord,
  draftFromSeed,
  draftFromTemplate,
  emptyDraft,
  parseSeed,
  type QuoteDraft,
  type QuoteRecord,
  type OfficeStartingValues,
} from "@/lib/quote";

/**
 * The surfaces the editor is mounted on.
 *
 * **The editor itself is surface-agnostic** — it takes a draft and reports
 * changes. Everything that differs between "the contractor's first quote ever"
 * and "quote four hundred" lives here: where the draft starts and what the
 * header says. What happens after Preview does not differ, which is why every
 * surface hands it to the same send flow.
 *
 * Server pages render these because a Server Component cannot hand a function
 * across the boundary, and the primary action is a function.
 */

export type OfficeIdentity = SenderOffice;

/**
 * Who is sending, and where it can go. Read on the server: whether email is set
 * up is a fact about the deployment, and the sign-in address is a fact about the
 * session.
 */
export type SendContext = {
  emailEnabled: boolean;
  selfEmail: string;
  selfPhone: string | null;
  /** The address already on the customer, if there is one. */
  customerEmail: string | null;
};

/** Where a sent quote's confirmation lives inside the app. */
function sentHref(quoteId: string) {
  return `/quotes/${quoteId}/sent`;
}

/**
 * A new quote — `/quotes/new`.
 *
 * The draft is built on the client from the seed rather than on the server,
 * because `draftFromSeed` is pure and the round trip would buy nothing. The
 * first save is what creates the Job, the Customer and the Quote row.
 */
export function NewQuoteSurface({
  seedText,
  template,
  jobId,
  customer,
  office: initialOffice,
  defaults,
  captures = [],
  demo = false,
  send,
}: {
  seedText?: string;
  /** A previous quote this one starts from — the Quick start path. */
  template?: QuoteRecord;
  jobId?: string;
  /** Set when the quote was started from a customer's page. */
  customer?: { id: string; name: string };
  office: OfficeIdentity;
  /** Where every new quote begins — the Office's defaults. */
  defaults?: OfficeStartingValues | null;
  captures?: CaptureItem[];
  /** Added to a demo job, so it carries the job's flag. */
  demo?: boolean;
  send: SendContext;
}) {
  const seed = useMemo(
    () => (seedText ? parseSeed(seedText) : undefined),
    [seedText]
  );

  // `useState` initialiser, not `useMemo`: the draft is state the editor owns
  // from here on, and re-deriving it would throw away everything typed since.
  const [initial] = useState<QuoteDraft>(() => {
    const base = template
      ? draftFromTemplate(template)
      : seed
        ? draftFromSeed(seed)
        : emptyDraft();

    // The shop's starting values — the tax rate, the deposit, the standard
    // exclusions. Copied in here, at creation, and never read back: changing a
    // default tomorrow cannot reach a quote written today.
    //
    // **Not applied to a template.** A duplicated quote carries decisions the
    // contractor actually made on that job, and the whole reason to duplicate
    // one is to keep them.
    const started = template ? base : applyOfficeDefaults(base, defaults ?? null);

    // Started from a customer's page: their name is already known, so the one
    // field a new quote requires arrives filled in.
    return customer ? { ...started, customerName: customer.name } : started;
  });

  const editor = useRef<QuoteEditorController>(null);
  const [office, setOffice] = useState(initialOffice);
  const [preview, setPreview] = useState<QuoteDraft | null>(null);

  return (
    <>
      <QuoteEditor
        initial={initial}
        office={office}
        onOfficeChange={setOffice}
        jobId={jobId}
        customerId={customer?.id}
        captures={captures}
        demo={demo}
        controllerRef={editor}
        previewLabel="Preview it"
        onPreview={setPreview}
      />

      <SendFlow
        editor={editor}
        preview={preview}
        onClosePreview={() => setPreview(null)}
        office={office}
        onOfficeChange={setOffice}
        hasOrganization
        demo={demo}
        {...send}
        sentHref={sentHref}
      />
    </>
  );
}

/** An existing quote — `/quotes/[id]`. */
export function ExistingQuoteSurface({
  record,
  office: initialOffice,
  captures = [],
  address,
  demo = false,
  send,
}: {
  record: QuoteRecord;
  office: OfficeIdentity;
  captures?: CaptureItem[];
  address?: string | null;
  demo?: boolean;
  send: SendContext;
}) {
  const router = useRouter();
  const [initial] = useState<QuoteDraft>(() => draftFromRecord(record));

  const editor = useRef<QuoteEditorController>(null);
  const [office, setOffice] = useState(initialOffice);
  const [preview, setPreview] = useState<QuoteDraft | null>(null);

  return (
    <>
      <QuoteEditor
        initial={initial}
        office={office}
        onOfficeChange={setOffice}
        captures={captures}
        address={address ?? undefined}
        demo={demo}
        controllerRef={editor}
        onBack={() => router.push("/quotes")}
        onPreview={setPreview}
        previewLabel="Preview & send"
        // Two modes of one quote: this is where it is written, View is what
        // was written.
        headerActions={
          <>
            <StandingLink quoteId={record.id} status={record.status} />
            <DocumentModeSwitch
              mode="edit"
              viewHref={`/quotes/${record.id}/view`}
              editHref={`/quotes/${record.id}`}
            />
          </>
        }
      />

      <SendFlow
        editor={editor}
        preview={preview}
        onClosePreview={() => setPreview(null)}
        office={office}
        onOfficeChange={setOffice}
        hasOrganization
        demo={demo}
        {...send}
        sentHref={sentHref}
      />
    </>
  );
}
