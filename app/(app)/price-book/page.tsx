import type { Metadata } from "next";

import { PageHeader } from "@/components/page-header";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
} from "@/components/ui/empty";

export const metadata: Metadata = { title: "Price Book" };

/**
 * The price book — differentiator #4, and a **reserved nav slot**.
 *
 * The IA home is claimed now so navigation stays stable when it ships in the
 * Depth phase. It is deliberately empty rather than absent: moving a nav item
 * later is more disruptive than showing a destination that says what is coming.
 *
 * The object-model constraint that shapes it: a price book entry is **a view
 * over the shop's accumulated line-item history**, not an object. Entries are
 * computed from real jobs, and hand-editing one would corrupt the arithmetic
 * that gives the price book its value.
 */
export default function PriceBookPage() {
  return (
    <div className="mx-auto flex w-full max-w-(--workspace-max-width) flex-col gap-10">
      <PageHeader
        title="Price Book"
        description="Your real numbers, learned from the jobs you've actually quoted."
      />

      <Empty>
        <EmptyHeader>
          <EmptyTitle>Still learning your numbers</EmptyTitle>
          <EmptyDescription>
            Every quote you send teaches this. Once there&apos;s enough history,
            your rates and materials pre-fill new quotes automatically — your
            pricing, not a canned database.
          </EmptyDescription>
        </EmptyHeader>
      </Empty>
    </div>
  );
}
