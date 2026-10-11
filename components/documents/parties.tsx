import type { ReactNode } from "react";

import {
  customerLines,
  type DocumentCustomer,
  type DocumentFact,
} from "@/lib/documents/parties";

/**
 * Under the letterhead: who the document is for, where the work is, and which
 * document this is — the three things every quote, contract and invoice
 * states before a word of the work.
 *
 * The quote projection and the paper view both draw it, as do the PDF and the
 * email in their own terms, from the same `customerLines` — so the customer's
 * page, the attachment and the printout name them the same way.
 *
 * `slots` is the Office's preview, where there is no customer yet: the places
 * their details will print are drawn as labelled gaps, never filled with an
 * invented person.
 */
export function DocumentParties({
  heading = "Prepared for",
  customer,
  jobAddress,
  number,
  facts = [],
  slots = false,
}: {
  heading?: string;
  customer: DocumentCustomer;
  jobAddress: string | null;
  number: string | null;
  facts?: DocumentFact[];
  slots?: boolean;
}) {
  const { name, rest } = customerLines(customer, jobAddress);
  const empty = !name && rest.length === 0;

  return (
    <div className="mt-4 grid gap-x-6 gap-y-4 text-xs @md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto]">
      <div className="min-w-0">
        <Label>{heading}</Label>
        {name ? (
          <p className="text-foreground text-sm font-medium [overflow-wrap:anywhere]">{name}</p>
        ) : slots ? (
          <Slot>Customer&apos;s name</Slot>
        ) : (
          <p className="text-muted-foreground text-sm">Your customer</p>
        )}
        {rest.map((line) => (
          <p key={line} className="text-muted-foreground mt-0.5 [overflow-wrap:anywhere]">
            {line}
          </p>
        ))}
        {slots && empty ? (
          <div className="mt-1 flex flex-wrap gap-1">
            <Slot>Billing address</Slot>
            <Slot>Phone</Slot>
            <Slot>Email</Slot>
          </div>
        ) : null}
      </div>

      {jobAddress || slots ? (
        <div className="min-w-0">
          <Label>Job site</Label>
          {jobAddress ? (
            <p className="text-foreground [overflow-wrap:anywhere]">{jobAddress}</p>
          ) : (
            <Slot>The job&apos;s address</Slot>
          )}
        </div>
      ) : (
        // Keeps the number in the right-hand column when there's no address.
        <div className="hidden @md:block" />
      )}

      {number || facts.length ? (
        <div className="@md:text-right">
          {number ? (
            <p className="text-foreground text-sm font-medium tabular-nums">{number}</p>
          ) : null}
          {facts.length ? (
            <dl className="mt-1 grid grid-cols-[auto_auto] justify-start gap-x-3 gap-y-0.5 @md:justify-end">
              {facts.map((fact) => (
                <Fact key={fact.label} label={fact.label} value={fact.value} />
              ))}
            </dl>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function Fact({ label, value }: DocumentFact) {
  return (
    <>
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="text-foreground tabular-nums">{value}</dd>
    </>
  );
}

function Label({ children }: { children: ReactNode }) {
  return (
    <p className="text-muted-foreground mb-1 font-label text-[10px] uppercase">{children}</p>
  );
}

function Slot({ children }: { children: ReactNode }) {
  return (
    <span className="text-muted-foreground border-muted-foreground/50 inline-block rounded border border-dashed px-1.5 py-px text-xs">
      {children}
    </span>
  );
}

/**
 * The business's own contact lines under its name — phone and email, then
 * where it is and its website. What a customer needs to write, call or look
 * the shop up, as every letterhead carries it.
 */
export function LetterheadContact({
  phone,
  email,
  address,
  website,
}: {
  phone?: string | null;
  email?: string | null;
  address?: string | null;
  website?: string | null;
}) {
  const reach = [phone, email].filter(Boolean).join(" · ");
  const where = [address, website].filter(Boolean).join(" · ");
  return (
    <>
      {reach ? <p className="text-muted-foreground mt-1 text-xs">{reach}</p> : null}
      {where ? (
        <p className="text-muted-foreground mt-0.5 text-xs [overflow-wrap:anywhere]">{where}</p>
      ) : null}
    </>
  );
}
