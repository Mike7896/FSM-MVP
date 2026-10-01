import Link from "next/link";

import { LocalTime } from "@/components/local-time";
import { Progress } from "@/components/ui/progress";
import type { ActivationUsage } from "@/lib/membership/activation";
import { formatBytes } from "@/lib/membership/format";

/**
 * What the shop has used this month — Billing §3.1, §2.2.
 *
 * On Free the job count is the whole story, so it leads, with the exact reset
 * moment in the contractor's own time zone. On a paid plan the count is still
 * shown, because it's real and it's theirs, but nothing about it is a limit.
 */
export function UsageCard({
  usage,
  storage,
}: {
  usage: ActivationUsage;
  storage: { usedBytes: number; limitBytes: number } | null;
}) {
  const limited = usage.limit !== null;
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <div className="rounded-2xl border bg-card p-6 sm:p-8">
        <p className="text-muted-foreground font-label text-[11px] uppercase">New jobs this month</p>
        <p className="mt-2 text-3xl font-semibold tracking-tight tabular-nums">
          {usage.used}
          {limited ? <span className="text-muted-foreground text-base font-normal"> of {usage.limit}</span> : null}
        </p>
        {limited ? (
          <Progress value={Math.min(100, (usage.used / usage.limit!) * 100)} className="mt-3" />
        ) : null}
        <p className="text-muted-foreground mt-3 text-sm">
          {limited ? (
            <>
              {usage.remaining === 0 ? "All used. " : `${usage.remaining} left. `}
              Resets <LocalTime iso={usage.resetsAt.toISOString()} />. Work on jobs you&apos;ve already started never uses another.{" "}
              {usage.remaining === 0 ? (
                <Link href="/upgrade" className="text-primary-ink underline underline-offset-4">Lift the limit</Link>
              ) : null}
            </>
          ) : (
            "No limit on your plan."
          )}
        </p>
      </div>

      {storage ? (
        <div className="rounded-2xl border bg-card p-6 sm:p-8">
          <p className="text-muted-foreground font-label text-[11px] uppercase">Photos and attachments</p>
          <p className="mt-2 text-3xl font-semibold tracking-tight tabular-nums">
            {formatBytes(storage.usedBytes)}
            <span className="text-muted-foreground text-base font-normal"> of {formatBytes(storage.limitBytes)}</span>
          </p>
          <Progress value={Math.min(100, (storage.usedBytes / storage.limitBytes) * 100)} className="mt-3" />
          <p className="text-muted-foreground mt-3 text-sm">
            {storage.usedBytes >= storage.limitBytes
              ? "Full — new attachments are paused. Sending documents isn't affected."
              : "Up to 20 MB a file. Documents you send never count."}
          </p>
        </div>
      ) : null}
    </div>
  );
}
