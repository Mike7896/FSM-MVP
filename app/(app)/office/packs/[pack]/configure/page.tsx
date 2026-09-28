import Link from "next/link";
import type { Metadata } from "next";

import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export const metadata: Metadata = { title: "Pack defaults" };

/**
 * Screen 39 · pack configuration, first run · Flow 13, job TP3.
 *
 * **"It's already working" comes first.** A working system on day one that the
 * business tunes — configuration is never the price of admission, and the pack
 * is live before this screen opens. "Later" is a first-class button on the same
 * row as Save.
 *
 * The versioning promise belongs in the copy rather than only in the
 * architecture: tuned numbers survive pack updates, which add templates and
 * never overwrite what the business changed.
 *
 * **The rates start empty.** They are the business's numbers, so none is
 * filled in for it — a figure in the box would be a figure it never chose.
 */

const RATES = [
  { id: "journeyman", label: "Journeyman hour" },
  { id: "apprentice", label: "Apprentice hour" },
  { id: "copper", label: "Copper markup" },
  { id: "minimum", label: "Minimum service call" },
];

export default async function PackConfigurePage({
  params,
}: PageProps<"/office/packs/[pack]/configure">) {
  const { pack } = await params;

  return (
    <div className="flex flex-col gap-8">
      <PageHeader
        title="Pack defaults"
        description="Your rates for this trade. Leave any you don't use empty."
      />

      <div className="border-primary/60 bg-primary/[0.03] flex flex-col items-start gap-4 rounded-lg @xl/office:flex-row @xl/office:items-center @xl/office:justify-between border p-4">
        <div>
          <p className="text-sm">
            <strong className="font-medium">It&apos;s already working.</strong>{" "}
            Nothing here blocks a quote.
          </p>
          <p className="text-muted-foreground mt-1 text-xs">
            You can come back any time.
          </p>
        </div>
        <Button asChild size="sm" className="shrink-0">
          <Link href="/quotes/new">Start a quote</Link>
        </Button>
      </div>

      <section className="rounded-lg border p-5">
        <p className="font-label text-[11px] uppercase">
          Your rates
        </p>
        <div className="mt-4 flex flex-col">
          {RATES.map((rate) => (
            <div
              key={rate.id}
              className="flex flex-col items-start gap-3 border-t @md/office:flex-row @md/office:items-center @md/office:justify-between py-4 first:border-t-0 first:pt-0"
            >
              <Label htmlFor={rate.id} className="font-normal">
                {rate.label}
              </Label>
              <Input
                id={rate.id}
                placeholder="None"
                className="w-full text-right tabular-nums @md/office:w-28"
              />
            </div>
          ))}
        </div>
      </section>

      <p className="text-muted-foreground rounded-lg border p-4 text-sm">
        When we update the {pack} pack, your numbers stay yours — updates add
        templates, they never overwrite what you&apos;ve tuned.
      </p>

      <div className="flex gap-2">
        <Button className="flex-1">Save</Button>
        <Button variant="outline">Later</Button>
      </div>
    </div>
  );
}
