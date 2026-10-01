import type { Metadata } from "next";
import Link from "next/link";
import { ChevronLeft } from "lucide-react";

import { RequestForm } from "@/components/help/request-form";
import { getCurrentUser, requireSession } from "@/lib/dal";
import type { SupportKind } from "@/lib/support/types";

import { pageFrom } from "../help-links";

export const metadata: Metadata = { title: "Contact us · Help" };

const KINDS = new Set<SupportKind>(["bug", "idea", "help"]);

/**
 * Reaching us — a problem, an idea, or a request for a person.
 *
 * `?kind` picks which door they came through (they can still change it);
 * `?from` is the page it's about.
 */
export default async function ContactPage({ searchParams }: PageProps<"/help/contact">) {
  const [session, profile, params] = await Promise.all([
    requireSession(),
    getCurrentUser(),
    searchParams,
  ]);
  const kind =
    typeof params.kind === "string" && KINDS.has(params.kind as SupportKind)
      ? (params.kind as SupportKind)
      : "help";

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-8">
      <div>
        <Link
          href="/help"
          className="text-muted-foreground hover:text-foreground inline-flex items-center gap-1 text-sm"
        >
          <ChevronLeft className="size-4" />
          Help
        </Link>
        <h1 className="mt-4 text-2xl font-semibold tracking-tight">Contact us</h1>
        <p className="text-muted-foreground mt-2">
          Tell us what&apos;s wrong, what you wish it did, or what you&apos;re stuck on. A person
          reads every one.
        </p>
      </div>

      <RequestForm
        key={kind}
        initialKind={kind}
        page={pageFrom(params.from)}
        name={profile?.fullName ?? null}
        email={session.email}
      />
    </div>
  );
}
