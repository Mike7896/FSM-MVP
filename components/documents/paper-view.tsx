import type { ReactNode } from "react";
import { ShieldCheck } from "lucide-react";

import { inkFor } from "@/components/documents/ink";
import { SignatureMark } from "@/components/signing/signature-mark";
import { Separator } from "@/components/ui/separator";
import {
  paperDate,
  type PaperBlock,
  type PaperDocument,
  type PaperSignature,
} from "@/lib/documents/paper";
import { parseMark } from "@/lib/signing/mark";
import { cn } from "@/lib/utils";

/**
 * A `PaperDocument` on the web — for the documents whose page isn't the
 * quote's: a change order, an invoice.
 *
 * Set to read exactly like `QuoteProjection` — the same letterhead, the same
 * rules between rows, the same total — so every document on the customer's
 * link is recognisably one family of paper. And drawn from the same
 * `PaperDocument` as the PDF and the email, so the three copies of one change
 * order say the same thing in the same order.
 */
export function PaperView({
  paper,
  after,
  signaturePrompt,
}: {
  paper: PaperDocument;
  /** Something the web page shows that paper can't — an invoice's photos. */
  after?: ReactNode;
  /** What the customer's empty line says, where they sign below the page. */
  signaturePrompt?: string | null;
}) {
  const { letterhead } = paper;
  const ink = inkFor(paper.kind === "change_order" ? "Change order" : paper.kind);

  return (
    <div className="flex flex-col gap-6">
      <header>
        {paper.demo ? (
          <p className="text-muted-foreground mb-3 inline-block rounded border border-dashed px-2 py-0.5 font-label text-[10px] uppercase">
            Demo · not a real {paper.label.toLowerCase()}
          </p>
        ) : null}
        {letterhead.logoUrl ? (
          // eslint-disable-next-line @next/next/no-img-element -- a public image the business uploaded, drawn at whatever size it is
          <img
            src={letterhead.logoUrl}
            alt=""
            className="mb-2 block h-10 w-auto max-w-[180px] object-contain"
          />
        ) : null}
        {letterhead.name ? (
          <p className="text-base font-semibold tracking-tight">{letterhead.name}</p>
        ) : null}
        {letterhead.license ? (
          <p className="text-muted-foreground mt-1 flex items-center gap-1.5 text-xs">
            <ShieldCheck className="size-3" />
            LIC #{letterhead.license}
          </p>
        ) : null}
        {letterhead.phone ? (
          <p className="text-muted-foreground mt-1 text-xs">{letterhead.phone}</p>
        ) : null}
        <p className="text-muted-foreground mt-3 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-0.5 text-xs">
          <span>
            {[
              paper.preparedFor ? `Prepared for ${paper.preparedFor}` : null,
              paper.jobAddress,
            ]
              .filter(Boolean)
              .join(" · ")}
          </span>
          {paper.number ? <span className="tabular-nums">{paper.number}</span> : null}
        </p>
      </header>

      <Separator />

      <section>
        <p className={cn("font-label mb-1.5 text-[11px] font-semibold uppercase", ink.word)}>
          {paper.label}
        </p>
        <h3 className="text-base font-semibold tracking-tight">
          {paper.title ?? paper.label}
        </h3>
      </section>

      {after}

      {paper.blocks.map((block, index) => (
        <Block
          key={index}
          block={block}
          signaturePrompt={signaturePrompt}
          // A total straight after its rows closes the same table.
          attached={paper.blocks[index - 1]?.kind === "lines"}
        />
      ))}
    </div>
  );
}

function Block({
  block,
  signaturePrompt,
  attached = false,
}: {
  block: PaperBlock;
  signaturePrompt?: string | null;
  attached?: boolean;
}) {
  switch (block.kind) {
    case "text":
      return (
        <section>
          {block.heading ? <Heading>{block.heading}</Heading> : null}
          <p
            className={cn(
              "leading-relaxed whitespace-pre-line",
              block.heading && "mt-1",
              block.quiet && "text-muted-foreground"
            )}
          >
            {block.body}
          </p>
        </section>
      );

    case "lines":
      return (
        <section>
          {block.heading ? <Heading className="mb-1">{block.heading}</Heading> : null}
          {block.lines.map((line, index) => (
            <div
              key={index}
              className={cn(
                "flex items-baseline justify-between gap-3 border-t py-2",
                line.depth && "border-border/50 text-muted-foreground py-1.5 text-[0.9em]"
              )}
              style={line.depth ? { paddingLeft: `${line.depth * 1.25}rem` } : undefined}
            >
              <span className="min-w-0">
                {line.description}
                {line.detail ? (
                  <span className="text-muted-foreground block text-xs">{line.detail}</span>
                ) : null}
              </span>
              {line.amount ? (
                <span className="shrink-0 tabular-nums">{line.amount}</span>
              ) : null}
            </div>
          ))}
        </section>
      );

    case "phase":
      return (
        <section>
          <p className="font-label mb-1 text-[11px] font-semibold uppercase">{block.heading}</p>
          {block.lines.map((line, index) => (
            <div
              key={index}
              className={cn(
                "flex items-baseline justify-between gap-3 border-t py-2",
                line.depth && "border-border/50 text-muted-foreground py-1.5 text-[0.9em]"
              )}
              style={line.depth ? { paddingLeft: `${line.depth * 1.25}rem` } : undefined}
            >
              <span className="min-w-0">{line.description}</span>
              {line.amount ? <span className="shrink-0 tabular-nums">{line.amount}</span> : null}
            </div>
          ))}
          <div className="flex items-baseline justify-between gap-3 border-t pt-2 font-medium">
            <span className="min-w-0">
              {block.bill.label}
              {block.bill.note ? (
                <span className="text-muted-foreground block text-xs font-normal">{block.bill.note}</span>
              ) : null}
            </span>
            <span className="shrink-0 tabular-nums">{block.bill.value}</span>
          </div>
        </section>
      );

    case "totals":
      return (
        <section className={cn(attached && "-mt-6")}>
          {block.lines.map((line, index) => (
            <div
              key={index}
              className="text-muted-foreground flex items-baseline justify-between gap-3 border-t py-2"
            >
              <span>{line.label}</span>
              <span className="tabular-nums">{line.value}</span>
            </div>
          ))}
          <div className="flex items-baseline justify-between gap-3 border-t pt-3">
            <span className="font-label text-[11px] uppercase">{block.total.label}</span>
            <span className="text-2xl font-semibold tabular-nums">{block.total.value}</span>
          </div>
        </section>
      );

    case "list":
      return (
        <section>
          <Heading>{block.heading}</Heading>
          <ul className="mt-1 space-y-1">
            {block.items.map((item, index) => (
              <li key={index} className="leading-relaxed">
                {item}
              </li>
            ))}
          </ul>
        </section>
      );

    case "offer":
      return (
        <section className="border-muted-foreground/40 rounded-md border border-dashed p-3">
          <Heading>{block.heading}</Heading>
          {block.lines.map((line, index) => (
            <div key={index} className="mt-1.5 flex items-baseline justify-between gap-3">
              <span className="min-w-0">{line.description}</span>
              <span className="shrink-0 tabular-nums">{line.amount}</span>
            </div>
          ))}
          <p className="text-muted-foreground mt-2 text-xs">{block.note}</p>
        </section>
      );

    case "signatures":
      return (
        <section className="mt-4">
          <Heading>{block.heading}</Heading>
          <p className="text-muted-foreground mt-1 text-xs leading-relaxed">{block.note}</p>
          <div className="mt-2 grid gap-x-8 gap-y-6 @2xs:grid-cols-2">
            {block.lines.map((line, index) => (
              <SignatureLine
                key={index}
                line={line}
                // Only her line — the second — waits for her below the page.
                prompt={index === 1 ? signaturePrompt : null}
              />
            ))}
          </div>
        </section>
      );
  }
}

function SignatureLine({
  line,
  prompt,
}: {
  line: PaperSignature;
  prompt?: string | null;
}) {
  return (
    <div className="min-w-0">
      <div className="flex h-16 items-end overflow-hidden pb-1">
        {line.mark ? (
          <SignatureMark
            value={line.mark}
            className={
              parseMark(line.mark).kind === "drawn"
                ? "h-14 w-auto max-w-full"
                : "text-[18pt] leading-none whitespace-nowrap"
            }
          />
        ) : prompt ? (
          <span className="text-muted-foreground text-xs">{prompt}</span>
        ) : null}
      </div>
      <div className="border-foreground/70 border-t" />
      <div className="mt-1.5 flex items-baseline justify-between gap-3 text-xs">
        <span className="min-w-0 truncate">
          {line.printedName ?? <span className="text-muted-foreground">Signature</span>}
        </span>
        <span className="text-muted-foreground shrink-0 tabular-nums">
          {line.signedAt ? paperDate(line.signedAt) : "Date"}
        </span>
      </div>
      <p className="text-muted-foreground mt-0.5 truncate text-xs">{line.role ?? line.who}</p>
    </div>
  );
}

function Heading({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <p className={cn("text-muted-foreground font-label text-[10px] uppercase", className)}>
      {children}
    </p>
  );
}
