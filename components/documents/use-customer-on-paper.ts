"use client";

import { useEffect, useState } from "react";

import {
  customerFromRecord,
  type DocumentCustomer,
} from "@/lib/documents/parties";

/**
 * A customer's printable details, read from their record by id. Null until it
 * arrives, and for a quote whose customer isn't saved yet — the preview then
 * prints the name the draft carries, which is all there is.
 */
export function useCustomerOnPaper(customerId: string | null): DocumentCustomer | null {
  const [loaded, setLoaded] = useState<{ id: string; customer: DocumentCustomer } | null>(null);

  useEffect(() => {
    if (!customerId) return;
    const controller = new AbortController();
    fetch(`/api/v1/customers/${customerId}`, { signal: controller.signal })
      .then((response) => (response.ok ? response.json() : null))
      .then((body: { data?: Parameters<typeof customerFromRecord>[0] } | null) => {
        if (body?.data) setLoaded({ id: customerId, customer: customerFromRecord(body.data) });
      })
      .catch(() => {
        // Offline or aborted — the preview prints the name alone.
      });
    return () => controller.abort();
  }, [customerId]);

  return customerId && loaded?.id === customerId ? loaded.customer : null;
}
