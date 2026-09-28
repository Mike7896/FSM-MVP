"use client";

import { Paperclip } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import type { ReceiptItem } from "@/lib/queries/receipts";
import { formatMoney } from "@/lib/quote";
import styles from "./receipt-rail.module.css";

function purchaseDate(value: string | null) {
  if (!value) return "Date not recorded";
  return new Date(`${value}T12:00:00Z`).toLocaleDateString("en-US", {
    month: "short", day: "numeric", year: "numeric", timeZone: "UTC",
  });
}

export function ReceiptRail({ receipts, demo = false }: { receipts: ReceiptItem[]; demo?: boolean }) {
  return (
    <div role="region" aria-label="Job receipts" tabIndex={0} className="-mx-1 mt-3 overflow-x-auto rounded px-1 pb-3 focus-visible:outline-2 focus-visible:outline-ring">
      <ol className="flex w-max items-start gap-5 pt-1">
        {receipts.map(receipt => (
          <li key={receipt.id} className="w-[164px] shrink-0">
            <Dialog>
              <DialogTrigger asChild>
                <button type="button" className={styles.trigger} aria-label={`Open receipt from ${receipt.vendor || "unknown vendor"}, ${formatMoney(receipt.amountCents)}`}>
                  <ReceiptThumbnail receipt={receipt} demo={demo} />
                </button>
              </DialogTrigger>
              <DialogContent className="max-h-[85dvh] overflow-y-auto sm:max-w-lg">
                <DialogHeader className="pr-8">
                  <DialogTitle>{receipt.vendor || "Receipt"}</DialogTitle>
                  <DialogDescription>{purchaseDate(receipt.purchasedOn)}{demo ? " · Demo receipt" : ""}</DialogDescription>
                </DialogHeader>
                <dl className="space-y-4 text-sm">
                  <div className="flex justify-between gap-4 border-y py-4"><dt>Amount paid</dt><dd className="text-xl font-semibold tabular-nums">{formatMoney(receipt.amountCents)}</dd></div>
                  <div><dt className="text-muted-foreground mb-1">What it was for</dt><dd className="whitespace-pre-wrap break-words">{receipt.description || "No description recorded."}</dd></div>
                  {receipt.category ? <div><dt className="text-muted-foreground mb-1">Category</dt><dd>{receipt.category}</dd></div> : null}
                </dl>
                {receipt.attachmentUrl ? (
                  <a href={receipt.attachmentUrl} target="_blank" rel="noopener noreferrer" className="flex items-center gap-2 text-sm underline underline-offset-4"><Paperclip className="size-4" />View original photo or PDF<span className="sr-only"> (opens in a new tab)</span></a>
                ) : <p className="text-muted-foreground text-xs">{receipt.hasAttachment ? "Attachment unavailable. Refresh to try again." : "No photo or PDF attached."}</p>}
              </DialogContent>
            </Dialog>
          </li>
        ))}
      </ol>
    </div>
  );
}

/** Prints only recorded facts: no invented tax, line items or payment method. */
export function ReceiptThumbnail({ receipt, demo = false }: { receipt: ReceiptItem; demo?: boolean }) {
  return (
    <div className={styles.paper}>
      <p className="text-center text-[9px] tracking-[0.18em] uppercase">{demo ? "Demo receipt" : "Receipt"}</p>
      <p className="mt-3 line-clamp-2 text-center text-[13px] leading-snug font-bold break-words uppercase">{receipt.vendor || "Vendor not recorded"}</p>
      <p className="mt-2 text-center text-[9px]">{purchaseDate(receipt.purchasedOn)}</p>
      <div className="mt-4 border-t border-dashed border-[#b6afa0] pt-3">
        <p className="line-clamp-5 text-[10px] leading-[1.7] whitespace-pre-wrap break-words">{receipt.description || "Job expense"}</p>
      </div>
      <div className="mt-auto border-t border-dashed border-[#b6afa0] pt-3">
        <div className="flex items-baseline justify-between gap-2"><span className="text-[9px] uppercase">Paid</span><span className="text-base font-bold tabular-nums">{formatMoney(receipt.amountCents)}</span></div>
        <p className="mt-3 text-center text-[8px] text-[#6e685e]">{receipt.hasAttachment ? "Photo / PDF attached" : "Recorded on this job"}</p>
      </div>
    </div>
  );
}
