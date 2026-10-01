"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useState } from "react";

/**
 * TanStack Query.
 *
 * **Not a replacement for server-rendered data.** Most reads in this app should
 * stay in Server Components going through `lib/dal.ts` — that is where the
 * authorization boundary lives, and moving a read to the client moves it out
 * from behind that boundary. Query is for the cases RSC handles badly:
 *
 * - polling something that changes without a navigation (has she opened the
 *   quote yet, has the deposit cleared)
 * - optimistic writes against `/api/v1` where the contractor should not wait
 *   for a round trip — line-item edits in the quote editor
 * - infinite lists and background refetch on a long-lived screen
 *
 * The client is created inside the component rather than at module scope: a
 * module-level client is shared across requests on the server, which leaks one
 * user's cached data into another's render.
 */
export function QueryProvider({ children }: { children: React.ReactNode }) {
  const [client] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            // A contractor on site is on a bad connection; refetching on every
            // window focus burns their data and their battery for little gain.
            refetchOnWindowFocus: false,
            staleTime: 30_000,
            retry: 1,
          },
        },
      })
  );

  return (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
}
