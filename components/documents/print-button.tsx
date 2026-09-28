"use client";

import { Printer } from "lucide-react";

import { Button } from "@/components/ui/button";

/**
 * Print, which is also how a PDF is made today.
 *
 * Every browser's print dialog can save to PDF, and the page it prints is the
 * page on screen — so until a server-side export exists, this is a real PDF
 * button rather than a promise of one. When that export lands it renders the
 * same sheet, so what comes out will not change.
 */
export function PrintButton({ label = "Print or save as PDF" }: { label?: string }) {
  return (
    <Button variant="outline" onClick={() => window.print()}>
      <Printer />
      {label}
    </Button>
  );
}
