"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";

import { DocumentSheet } from "@/components/documents/document-sheet";

// Lay out a Letter page at its actual size before shrinking the whole page.
// Changing the font size alone leaves rem-sized headings, gaps and icons huge.
const PAGE_WIDTH = 816;

export function OfficeDocumentPreview({
  children,
  footer,
}: {
  children: ReactNode;
  footer: ReactNode;
}) {
  const frame = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState<number | null>(null);

  useEffect(() => {
    const element = frame.current;
    if (!element) return;
    const observer = new ResizeObserver(([entry]) => {
      setScale(entry.contentRect.width / PAGE_WIDTH);
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  return (
    <div className="rounded-xl border bg-muted/30 p-4 sm:p-5">
      <div
        ref={frame}
        className="relative mx-auto aspect-[8.5/11] w-full max-w-[480px] bg-white shadow-[0_2px_8px_rgb(0_0_0/0.12)]"
        aria-label="Document preview, US Letter portrait"
      >
        <div
          className="absolute left-0 top-0 w-[816px] origin-top-left"
          style={{ transform: `scale(${scale ?? 0})`, visibility: scale === null ? "hidden" : "visible" }}
        >
          <DocumentSheet
            className="h-[1056px] min-h-[1056px] w-[816px] max-w-none overflow-hidden p-[96px] shadow-none [overflow-wrap:anywhere]"
            footer={footer}
          >
            {children}
          </DocumentSheet>
        </div>
      </div>
      <p className="text-muted-foreground mt-3 text-center text-[10px]">US Letter · 8½ × 11 in</p>
    </div>
  );
}
