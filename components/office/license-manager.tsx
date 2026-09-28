"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Loader2, Plus, TriangleAlert } from "lucide-react";
import { toast } from "sonner";

import {
  ResponsiveDialog,
  ResponsiveDialogBody,
  ResponsiveDialogContent,
  ResponsiveDialogFooter,
  ResponsiveDialogHeader,
} from "@/components/responsive-dialog";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "@/components/ui/empty";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { LicenseRow } from "@/lib/queries/office";
import { licenseSchema, type LicenseFormValues } from "@/lib/schemas";

/**
 * Screen 45 · the License Manager · differentiator #6, job L1.
 *
 * Drawn at differentiator depth rather than as a settings afterthought. In many
 * trades licensing is not statewide — Pennsylvania electricians are licensed
 * **per municipality** — so a shop working across town lines juggles a mental
 * inventory of numbers, jurisdictions and renewal dates.
 *
 * **The gap is worth more than the match.** Telling a contractor he has no
 * license for a town he is already quoting in beats attaching one correctly,
 * and it is the case that justifies this whole surface. The warning below is
 * computed from the jobs that actually exist, so it appears when the work does
 * and disappears the moment a license is added — never asserted, never a
 * hardcoded county.
 *
 * **We never claim more certainty than we have.** The warning says our data is
 * not authoritative, because it is derived from a job address and a contractor
 * may well be registered somewhere we cannot see.
 */
export function LicenseManager({
  licenses,
  gaps,
}: {
  licenses: LicenseRow[];
  gaps: { jurisdiction: string; jobCount: number }[];
}) {
  const [editing, setEditing] = useState<LicenseRow | "new" | null>(null);

  // The one with an action attached keeps the gate treatment above the table
  // rather than becoming a date in a column.
  const renewing = licenses.find((license) => license.state === "expiring");

  return (
    <div className="flex flex-col gap-6">
      <div className="flex justify-end">
        <Button onClick={() => setEditing("new")}>
          <Plus />
          Add a license
        </Button>
      </div>

      {gaps.length ? (
        <Alert variant="destructive">
          <TriangleAlert />
          <AlertTitle>
            {gaps.length === 1
              ? `Nothing on file for ${gaps[0].jurisdiction}`
              : `Nothing on file for ${gaps.length} jurisdictions you're working in`}
          </AlertTitle>
          <AlertDescription>
            <p>
              {gaps
                .map(
                  (gap) =>
                    `${gap.jurisdiction} — ${gap.jobCount} job${gap.jobCount === 1 ? "" : "s"}`
                )
                .join(" · ")}
            </p>
            <p>
              A missing local license isn&apos;t a cosmetic problem on a
              document. A permit authorises one job at one address, and a
              township that licenses its own contractors will not issue one to a
              business it has no record of — so this is a job that can&apos;t
              legally start. Check with the authority: our jurisdiction data
              comes from the job address and isn&apos;t authoritative.
            </p>
          </AlertDescription>
        </Alert>
      ) : null}

      {renewing ? (
        <div className="border-primary/60 bg-primary/[0.03] flex flex-wrap items-center justify-between gap-4 rounded-xl border p-5">
          <div>
            <p className="text-primary-ink font-label text-[10px] uppercase">
              Renews in {renewing.daysToExpiry} days
            </p>
            <p className="mt-1.5 font-medium">
              {renewing.name ?? renewing.jurisdiction}
            </p>
            <p className="text-muted-foreground mt-1 text-sm">
              {renewing.name ? `${renewing.jurisdiction} · ` : ""}#
              {renewing.number} · {expiryLine(renewing)}
            </p>
          </div>
          <Button variant="outline" onClick={() => setEditing(renewing)}>
            Mark it renewed
          </Button>
        </div>
      ) : null}

      {licenses.length === 0 ? (
        <Empty className="rounded-xl border">
          <EmptyHeader>
            <EmptyTitle>No licenses on file yet</EmptyTitle>
            <EmptyDescription>
              Add the one your customers look for. It goes at the top of every
              quote you send, and it&apos;s what authorizes the permits you pull.
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : (
        <>
          {/* A table earns its place here — four columns of genuinely tabular
              data with a usage count. This is the one surface in the product
              where a table is the right answer, and only at desk width. */}
          <div className="hidden overflow-x-auto rounded-xl border @3xl/office:block">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-muted-foreground border-b [&>th]:px-4 [&>th]:py-2.5 [&>th]:text-left [&>th]:font-label [&>th]:text-[10px] [&>th]:uppercase">
                  <th>Name</th>
                  <th>Jurisdiction</th>
                  <th>Number</th>
                  <th>Expires</th>
                  <th className="!text-right">On quotes</th>
                  <th className="w-px" />
                </tr>
              </thead>
              <tbody>
                {licenses.map((license) => (
                  <tr key={license.id} className="border-b last:border-b-0">
                    <td className="px-4 py-3 font-medium">
                      {license.name ?? (
                        <span className="text-muted-foreground font-normal">
                          —
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <span>{license.jurisdiction}</span>
                      {license.class ? (
                        <span className="text-muted-foreground">
                          {" "}
                          · {license.class}
                        </span>
                      ) : null}
                    </td>
                    <td className="text-muted-foreground px-4 py-3 tabular-nums">
                      {license.number}
                    </td>
                    <td className="px-4 py-3">
                      <span className="flex flex-wrap items-center gap-2">
                        {expiryDate(license)}
                        <ExpiryBadge license={license} />
                      </span>
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums">
                      {license.usedOnQuotes}
                    </td>
                    <td className="px-2 py-3">
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => setEditing(license)}
                      >
                        Edit
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Below the table's width the same rows read as cards. */}
          <div className="rounded-xl border @3xl/office:hidden">
            {licenses.map((license, index) => (
              <div
                key={license.id}
                className={`flex flex-wrap items-center justify-between gap-4 p-4 ${index ? "border-t" : ""}`}
              >
                <div className="min-w-0">
                  <div className="flex flex-wrap items-baseline gap-2">
                    <span className="font-medium">
                      {license.name ?? license.jurisdiction}
                    </span>
                    {license.name ? (
                      <span className="text-sm">{license.jurisdiction}</span>
                    ) : null}
                    <span className="text-muted-foreground text-sm">
                      #{license.number}
                    </span>
                    {license.class ? (
                      <Badge variant="outline">{license.class}</Badge>
                    ) : null}
                    <ExpiryBadge license={license} />
                  </div>
                  <p className="text-muted-foreground mt-1 text-sm">
                    {expiryLine(license)}
                  </p>
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setEditing(license)}
                >
                  Edit
                </Button>
              </div>
            ))}
          </div>

          <div className="text-muted-foreground flex flex-col gap-2 text-sm">
            <p>
              We suggest the right one when a job&apos;s address matches a town
              you&apos;re registered in — and warn you when it doesn&apos;t.{" "}
              <strong className="text-foreground font-medium">
                We never attach one on your behalf.
              </strong>
            </p>
            <p>
              Expired licenses stay listed because they&apos;re on documents
              you&apos;ve already sent.
            </p>
          </div>
        </>
      )}

      {editing ? (
        <LicenseSheet
          license={editing === "new" ? null : editing}
          onClose={() => setEditing(null)}
        />
      ) : null}
    </div>
  );
}

/**
 * What the calendar says, not what the status column says.
 *
 * A license the shop wrote down as active two years ago is not active because
 * the row still says so — the date is the thing that revokes it.
 */
function ExpiryBadge({ license }: { license: LicenseRow }) {
  if (license.state === "expired") {
    return <Badge variant="destructive">Expired</Badge>;
  }
  if (license.state === "expiring") {
    return <Badge variant="secondary">Renews in {license.daysToExpiry}d</Badge>;
  }
  return null;
}

function expiryLine(license: LicenseRow) {
  const parts: string[] = [];
  if (license.holder) parts.push(license.holder);

  if (license.expiresOn) {
    const when = new Date(license.expiresOn).toLocaleDateString(undefined, {
      month: "short",
      day: "numeric",
      year: "numeric",
    });
    parts.push(
      license.state === "expired"
        ? `Expired ${when}`
        : `Valid through ${when}`
    );
  } else {
    // Stated rather than hidden. An expiry we do not have is a renewal we
    // cannot remind him about, and he is the only one who can fix that.
    parts.push("No expiry date on file — we can't remind you");
  }

  return parts.join(" · ");
}

/** Add or correct one. The same form either way — it is the same object. */
function LicenseSheet({
  license,
  onClose,
}: {
  license: LicenseRow | null;
  onClose: () => void;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [removing, startRemoving] = useTransition();

  const form = useForm<LicenseFormValues>({
    resolver: zodResolver(licenseSchema),
    defaultValues: {
      name: license?.name ?? "",
      jurisdiction: license?.jurisdiction ?? "",
      number: license?.number ?? "",
      class: license?.class ?? "",
      holder: license?.holder ?? "",
      issuedOn: license?.issuedOn ?? null,
      expiresOn: license?.expiresOn ?? null,
      renewalReminderDays: license?.renewalReminderDays ?? 60,
    },
  });

  const onSubmit = form.handleSubmit((values) => {
    startTransition(async () => {
      const response = await fetch(
        license ? `/api/v1/licenses/${license.id}` : "/api/v1/licenses",
        {
          method: license ? "PATCH" : "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(values),
        }
      );

      const body = (await response.json().catch(() => null)) as {
        error?: { message?: string };
      } | null;

      if (!response.ok) {
        form.setError("root", {
          message: body?.error?.message ?? "Couldn't save that license.",
        });
        return;
      }

      toast.success(license ? "License updated." : "License added.");
      onClose();
      router.refresh();
    });
  });

  function remove() {
    if (!license) return;
    startRemoving(async () => {
      const response = await fetch(`/api/v1/licenses/${license.id}`, {
        method: "DELETE",
      });

      if (!response.ok) {
        const body = (await response.json().catch(() => null)) as {
          error?: { message?: string };
        } | null;
        form.setError("root", {
          message: body?.error?.message ?? "Couldn't remove that license.",
        });
        return;
      }

      toast.success("License removed.");
      onClose();
      router.refresh();
    });
  }

  return (
    <ResponsiveDialog open onOpenChange={(open) => !open && onClose()}>
      <ResponsiveDialogContent desktopClassName="sm:max-w-lg">
        <ResponsiveDialogHeader
          title={license ? "Edit license" : "Add a license"}
          description="The jurisdiction is what a permit is matched on — a state, a county or a township, exactly as it's written on the card."
        />

        <form onSubmit={onSubmit}>
          <ResponsiveDialogBody className="flex flex-col gap-4">
            <div className="grid gap-2">
              <Label htmlFor="name">
                Name{" "}
                <span className="text-muted-foreground font-normal">
                  (optional)
                </span>
              </Label>
              <Input id="name" autoFocus {...form.register("name")} />
              <p className="text-muted-foreground text-xs">
                Just for telling your licenses apart. It never prints on a
                document — customers see the number.
              </p>
              <Note error={form.formState.errors.name?.message} />
            </div>

            <div className="grid gap-2">
              <Label htmlFor="jurisdiction">Jurisdiction</Label>
              <Input id="jurisdiction" {...form.register("jurisdiction")} />
              <Note error={form.formState.errors.jurisdiction?.message} />
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <div className="grid gap-2">
                <Label htmlFor="number">License number</Label>
                <Input id="number" {...form.register("number")} />
                <Note error={form.formState.errors.number?.message} />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="class">Class</Label>
                <Input id="class" {...form.register("class")} />
              </div>
            </div>

            <div className="grid gap-2">
              <Label htmlFor="holder">Held by</Label>
              <Input
                id="holder"
                placeholder="Whose name it's in"
                {...form.register("holder")}
              />
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <div className="grid gap-2">
                <Label htmlFor="issuedOn">Issued</Label>
                <Input
                  id="issuedOn"
                  type="date"
                  {...form.register("issuedOn", {
                    setValueAs: (v) => (v === "" ? null : v),
                  })}
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="expiresOn">Expires</Label>
                <Input
                  id="expiresOn"
                  type="date"
                  {...form.register("expiresOn", {
                    setValueAs: (v) => (v === "" ? null : v),
                  })}
                />
                <p className="text-muted-foreground text-xs">
                  We&apos;ll remind you 60 days out.
                </p>
              </div>
            </div>

            {form.formState.errors.root ? (
              <Alert variant="destructive">
                <AlertDescription>
                  {form.formState.errors.root.message}
                </AlertDescription>
              </Alert>
            ) : null}
          </ResponsiveDialogBody>

          <ResponsiveDialogFooter className="flex items-center justify-between gap-3">
            {license ? (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="text-muted-foreground hover:text-destructive"
                onClick={remove}
                disabled={removing}
              >
                {removing ? <Loader2 className="animate-spin" /> : null}
                Remove
              </Button>
            ) : (
              <span />
            )}
            <div className="flex gap-2">
              <Button type="button" variant="outline" onClick={onClose}>
                Cancel
              </Button>
              <Button type="submit" disabled={pending}>
                {pending ? <Loader2 className="animate-spin" /> : null}
                {license ? "Save" : "Add it"}
              </Button>
            </div>
          </ResponsiveDialogFooter>
        </form>
      </ResponsiveDialogContent>
    </ResponsiveDialog>
  );
}

function Note({ error }: { error?: string }) {
  if (!error) return null;
  return <p className="text-destructive text-xs">{error}</p>;
}

/** Just the date, for the table column that has a badge beside it. */
function expiryDate(license: LicenseRow) {
  if (!license.expiresOn) return "Not recorded";
  return new Date(license.expiresOn).toLocaleDateString(undefined, {
    month: "short",
    year: "numeric",
  });
}
