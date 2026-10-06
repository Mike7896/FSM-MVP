"use client";

import { createContext, useContext, useState, type ReactNode } from "react";

const PrintActivation = createContext<(() => void) | null>(null);

/** The server marks unactivated previews before hydration or native printing. */
export function PrintBoundary({ requiresActivation, children }: { requiresActivation: boolean; children: ReactNode }) {
  const [confirmed, setConfirmed] = useState(false);
  const draft = requiresActivation && !confirmed;
  return (
    <PrintActivation.Provider value={() => setConfirmed(true)}>
      <div data-print-unactivated={draft ? "true" : undefined} className="contents">
        {draft ? <p data-print="hide" className="bg-muted px-4 py-2 text-sm">Draft preview. Use Print or save as PDF to prepare a customer-ready copy.</p> : null}
        {children}
      </div>
    </PrintActivation.Provider>
  );
}

export function useConfirmPrintActivation() { return useContext(PrintActivation); }
