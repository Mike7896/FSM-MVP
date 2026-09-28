"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { useForm, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { toast } from "sonner";

import { SaveBar } from "@/components/save-bar";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  DocumentFooter,
  DocumentSheet,
} from "@/components/documents/document-sheet";
import { QuoteProjection } from "@/components/quote/projection";
import { emptyDraft } from "@/lib/quote";
import type { Office } from "@/lib/queries/office";
import {
  updateOfficeSchema,
  type OfficeFormValues,
} from "@/lib/schemas";

/**
 * An empty quote, so the preview is the header and nothing else.
 *
 * Everything drawn on it is his — the name, phone and license he has entered,
 * and visible gaps where he hasn't. No invented customer, job or price sits
 * around them: a made-up line on the page he is filling in reads as his own.
 */
const EMPTY_QUOTE = emptyDraft();

/**
 * Screen 27 · the Office's own attributes · job O2.
 *
 * **Consequence first.** The reason to fill this in is not that we need it —
 * it is that the customer is about to read it, so the form sits beside a live
 * projection of the document rather than beside an explanation of one. The
 * miniature fills in as he types, which is the same mechanism the activation
 * flow's profile gap uses and the reason that gap converts: he sees the
 * document get more professional before he commits.
 *
 * The projection is the **real** one — the same component the homeowner's page
 * renders — so it cannot drift from what she will actually see.
 */
export function IdentityForm({
  office,
  license,
  presetName,
}: {
  office: Office;
  /** The number a document would carry today, from the License Manager. */
  license: string | null;
  /** What document branding is currently set to. */
  presetName: string;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  const form = useForm<OfficeFormValues>({
    resolver: zodResolver(updateOfficeSchema),
    defaultValues: {
      name: office.name ?? "",
      phone: office.phone ?? "",
      email: office.email ?? "",
      address: office.address ?? "",
      website: office.website ?? "",
      logoUrl: office.logoUrl ?? "",
    },
  });

  // `useWatch` rather than `form.watch()`: the latter returns a function the
  // React Compiler cannot memoize, so it bails out of compiling the whole
  // component. This subscribes to the fields the preview actually reads.
  const values = useWatch({ control: form.control });

  const onSubmit = form.handleSubmit((raw) => {
    startTransition(async () => {
      const response = await fetch("/api/v1/office", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(raw),
      });

      const body = (await response.json().catch(() => null)) as {
        error?: { message?: string };
      } | null;

      if (!response.ok) {
        form.setError("root", {
          message: body?.error?.message ?? "Couldn't save. Try again.",
        });
        return;
      }

      toast.success("Saved. New documents go out under this.");
      form.reset(raw);
      // The header, the editor and every projection read this — refresh the
      // server tree rather than patching four caches by hand.
      router.refresh();
    });
  });

  return (
    <form onSubmit={onSubmit} className="w-full max-w-6xl @container/identity flex min-w-0 flex-col gap-6">
      {/* Use the panel's width: the app and Office sidebars also take space. */}
      <div className="grid min-w-0 gap-6 @4xl/identity:grid-cols-[minmax(0,1fr)_300px]">
        <div className="@container/fields flex min-w-0 flex-col gap-5">
          <div className="flex flex-col gap-6 rounded-xl border p-5 sm:p-6 [&_input]:h-10">
            <div className="grid gap-2">
              <Label htmlFor="name">Business name</Label>
              <Input id="name" {...form.register("name")} />
              <FieldNote error={form.formState.errors.name?.message}>
                Goes at the top of every quote, contract and invoice you send.
              </FieldNote>
            </div>

            <div className="grid gap-2">
              <Label htmlFor="address">Address</Label>
              <Input id="address" {...form.register("address")} />
              <FieldNote error={form.formState.errors.address?.message}>
                {/* Not the job address — a Job carries its own, because the same
                    customer&apos;s second job may be somewhere else entirely. */}
                Where the business is, not where the work is.
              </FieldNote>
            </div>

            <div className="grid gap-4 @md/fields:grid-cols-2">
              <div className="grid gap-2">
                <Label htmlFor="phone">Phone</Label>
                <Input id="phone" type="tel" {...form.register("phone")} />
                <FieldNote error={form.formState.errors.phone?.message}>
                  Shown on the document so she can just call you.
                </FieldNote>
              </div>
              <div className="grid gap-2">
                <Label htmlFor="email">Email</Label>
                <Input id="email" type="email" {...form.register("email")} />
                <FieldNote error={form.formState.errors.email?.message}>
                  Where a customer&apos;s reply lands.
                </FieldNote>
              </div>
            </div>

            <div className="grid gap-2">
              <Label htmlFor="website">Website</Label>
              <Input id="website" {...form.register("website")} />
              <FieldNote error={form.formState.errors.website?.message}>
                Optional. One more thing a customer can check you against.
              </FieldNote>
            </div>

            <div className="grid gap-2">
              <Label htmlFor="logoUrl">Logo</Label>
              <Input id="logoUrl" {...form.register("logoUrl")} />
              <FieldNote error={form.formState.errors.logoUrl?.message}>
                {/* Honest about what this is today. Uploading needs a storage
                    bucket and a signed-URL route; a link works now and a quote
                    without one still looks professional. */}
                A link to an image. Optional — a quote without one still looks
                professional.
              </FieldNote>
            </div>
          </div>

          {/* Two rows that point out rather than in. License number and logo
              placement belong to other pages in the Office, so they are links
              carrying their live value rather than duplicated controls — the
              header preview is where they visibly converge. */}
          <div className="rounded-xl border">
            <p className="text-muted-foreground border-b px-5 py-4 text-sm font-semibold">
              What else goes in the header
            </p>
            <OutRow
              label="License number"
              value={license ? `#${license}` : "Nothing on file yet"}
              note="Matched to the job's township, per quote"
              href="/office/licenses"
              linkText="Licenses"
            />
            <OutRow
              label="Logo placement and look"
              value={presetName}
              note="Three presets, previewed as she sees them"
              href="/office/branding"
              linkText="Document branding"
            />
          </div>

          <p className="text-muted-foreground rounded-xl border border-dashed p-5 text-sm leading-relaxed">
            Everything on this page is the{" "}
            <strong className="text-foreground font-medium">
              business&apos;s
            </strong>
            , which is why it&apos;s here and not in Settings. Your own sign-in
            and what you pay us with are yours, and they live in{" "}
            <Link
              href="/account"
              className="text-primary-ink underline underline-offset-4"
            >
              Account
            </Link>
            .
          </p>
        </div>

        <div className="flex min-w-0 flex-col gap-2 @4xl/identity:sticky @4xl/identity:top-22 @4xl/identity:self-start">
          <p className="text-sm font-semibold">
            On every document you send
          </p>
          <DocumentSheet
            size="note"
            className="[overflow-wrap:anywhere]"
            footer={<DocumentFooter businessName={values.name?.trim() || null} />}
          >
            <QuoteProjection
              draft={EMPTY_QUOTE}
              businessName={values.name?.trim() || null}
              license={license}
              phone={values.phone?.trim() || null}
            />
          </DocumentSheet>
          <p className="text-muted-foreground text-xs leading-relaxed">
            {license ? (
              <>
                The license number came from{" "}
                <Link
                  href="/office/licenses"
                  className="underline underline-offset-4"
                >
                  Licenses
                </Link>
                , matched to the job&apos;s township. Everything else on this
                header came from this page.
              </>
            ) : (
              <>
                Everything on this header came from this page. The license
                number would come from{" "}
                <Link
                  href="/office/licenses"
                  className="underline underline-offset-4"
                >
                  Licenses
                </Link>
                , matched to the job&apos;s township.
              </>
            )}
          </p>
        </div>
      </div>

      <SaveBar
        dirty={form.formState.isDirty}
        pending={pending}
        error={form.formState.errors.root?.message}
        note={
          form.formState.isDirty
            ? "Unsaved changes. Documents already sent keep the name they went out under."
            : undefined
        }
      />
    </form>
  );
}

function FieldNote({
  error,
  children,
}: {
  error?: string;
  children: React.ReactNode;
}) {
  return (
    <p
      className={
        error ? "text-destructive text-xs" : "text-muted-foreground text-xs"
      }
    >
      {error ?? children}
    </p>
  );
}

/**
 * A row that names something on another Office page and shows its live value.
 *
 * Duplicating the control here would give the contractor two places to change
 * one thing; showing the value and linking out gives them one place to change
 * it and one place to check it.
 */
function OutRow({
  label,
  value,
  note,
  href,
  linkText,
}: {
  label: string;
  value: string;
  note: string;
  href: string;
  linkText: string;
}) {
  return (
    <div className="flex min-w-0 flex-col gap-2 border-b px-5 py-4 last:border-b-0 @xl/fields:flex-row @xl/fields:flex-wrap @xl/fields:items-baseline @xl/fields:justify-between @xl/fields:gap-x-4">
      <div className="min-w-0">
        <p className="text-sm font-medium">{label}</p>
        <p className="text-muted-foreground mt-1 text-xs leading-relaxed">{note}</p>
      </div>
      <div className="flex min-w-0 flex-wrap items-baseline gap-x-3 gap-y-1">
        <span className="min-w-0 text-sm tabular-nums [overflow-wrap:anywhere]">{value}</span>
        <Link
          href={href}
          className="text-primary-ink text-sm underline underline-offset-4"
        >
          {linkText}
        </Link>
      </div>
    </div>
  );
}
