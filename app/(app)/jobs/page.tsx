import { TagFilters, TagBadges } from "@/components/tags/tag-controls";
import { listTags, tagsForRecords } from "@/lib/queries/tags";
import { parseTagFilter } from "@/lib/tags";
import Link from "next/link";
import type { Metadata } from "next";
import { ArrowUpRight, BriefcaseBusiness, Plus, Search, ShieldCheck } from "lucide-react";

import { DemoChip } from "@/components/demo-chip";
import { PageHeader } from "@/components/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
} from "@/components/ui/empty";
import { Input } from "@/components/ui/input";
import { requireActiveOrganization } from "@/lib/dal";
import { listJobs } from "@/lib/queries/jobs";
import { formatMoney } from "@/lib/quote";

import styles from "./jobs.module.css";

export const metadata: Metadata = { title: "Jobs" };

/**
 * The job list · class A·B.
 *
 * The triage band up top carries the same gates the dashboard shows — derived
 * once in `lib/queries/gates.ts` so the two surfaces cannot describe the same
 * deposit differently — and the list below it is exhaustive.
 *
 * **This is the only place a contractor browses a flat collection of top-level
 * things.** Everything else in the product nests under a Job, which is why each
 * row carries more than a list normally would: the money state, the permit
 * standing, and any open gate are the three questions that decide what happens
 * next, and none of them lives on the Job row itself.
 */
export default async function JobsPage({
  searchParams,
}: PageProps<"/jobs">) {
  const org = await requireActiveOrganization();
  const filters = parseTagFilter(await searchParams);
  const { q } = await searchParams;
  const search = typeof q === "string" && q.trim() ? q.trim() : undefined;

  const jobs = await listJobs(org.id, { ...filters, q: search });
  const gated = jobs.filter((job) => job.gate);

  const [availableTags, recordTags] = await Promise.all([listTags(org.id), tagsForRecords(org.id, "job", jobs.map(row => row.id))]);
  return (
    <div className={`@container ${styles.page}`}>
      <p className={styles.eyebrow}>YOUR WORK, ALL TOGETHER</p>
      <PageHeader
        className={styles.listHeader}
        title="Jobs"
        description="Everything that happens around one piece of work, in one place."
        actions={
          <Button asChild>
            <Link href="/jobs/new"><Plus size={16} /> New job</Link>
          </Button>
        }
      />

      {/* A GET form, so a search is a URL — shareable, back-button-safe, and
          working before the JavaScript has loaded. */}
      <form className={styles.search}>
          {filters.tags && <input type="hidden" name="tags" value={filters.tags} />}
          {filters.tagMode && <input type="hidden" name="tagMode" value={filters.tagMode} />}
        <Search className="text-muted-foreground pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2" />
        <Input
          name="q"
          aria-label="Search jobs"
          defaultValue={search ?? ""}
          placeholder="Customer, work, or address"
          className="h-11 rounded-lg border-border/70 bg-card pl-9 shadow-none"
        />
      </form>

      {/* The one framed block: a gate is permission, and an error costs in both
          directions. Framing it is the hierarchy. Collapses entirely when
          nothing is cleared — an empty gate list is a good outcome, not a
          state to display. */}
      {gated.length > 0 ? (
        <section className={styles.gate}>
          <p className="text-primary-ink mb-2.5 flex items-center gap-2 font-label text-[11px] uppercase">
            <ShieldCheck size={15} /> Cleared to proceed
          </p>
          {gated.map((job, i) => (
            <div
              key={job.id}
              className={`flex flex-col items-start justify-between gap-3 py-4 sm:flex-row sm:items-center sm:gap-6 ${
                i === 0 ? "" : "border-primary/20 border-t"
              }`}
            >
              <div className="min-w-0">
                <p className="text-sm">
                  <strong className="font-semibold">{job.customerName}</strong>{" "}
                  — {job.gate!.short}
                </p>
                <p className="text-muted-foreground mt-1 text-xs">
                  {[job.address, job.gate!.detail].filter(Boolean).join(" · ")}
                </p>
              </div>
              <Button asChild size="sm" variant={i === 0 ? "default" : "outline"}>
                <Link href={`/jobs/${job.id}`}>Open job</Link>
              </Button>
            </div>
          ))}
        </section>
      ) : null}

      <TagFilters organizationId={org.id} available={availableTags} />

      {jobs.length === 0 ? (
        <Empty>
          <EmptyHeader>
            <EmptyTitle>
              {(search || filters.tags || filters.tagMode === "untagged") ? "Nothing matched that." : "No jobs yet"}
            </EmptyTitle>
            <EmptyDescription>
              {(search || filters.tags || filters.tagMode === "untagged")
                ? "Try a customer's name, an address, or what the work was."
                : "A job is created the moment you write the first quote for it — you don't have to make one first."}
            </EmptyDescription>
          </EmptyHeader>
          <EmptyContent>
            <Button asChild>
              <Link href="/quotes/new">Write a quote</Link>
            </Button>
          </EmptyContent>
        </Empty>
      ) : (
        <div className={styles.jobList}>
          <div className={styles.listHeading}><h2>{(search || filters.tags || filters.tagMode === "untagged") ? "Search results" : "All jobs"}</h2><span>{jobs.length} {jobs.length === 1 ? "job" : "jobs"} shown</span></div>
          {jobs.map((job) => (
            <Link
              key={job.id}
              href={`/jobs/${job.id}`}
              className={styles.jobRow}
            >
              <div className={styles.rowIdentity}>
                <span className={styles.rowIcon} aria-hidden="true"><BriefcaseBusiness size={20} strokeWidth={1.5} /></span>
                <div className="min-w-0">
                  <div className="flex flex-wrap items-baseline gap-2">
                    <span className="text-muted-foreground text-xs tabular-nums">
                      #{job.number}
                    </span>
                    <span className="font-medium">{job.customerName}</span>
                    {/* A demo job has no money position to report, so DEMO is
                        its status. */}
                    {job.demo ? (
                      <DemoChip />
                    ) : (
                      <Badge variant="secondary" className="capitalize">
                        {job.status.replace(/_/g, " ")}
                      </Badge>
                    )}
                    {job.permitStatus ? (
                      <Badge variant="outline" className="capitalize">
                        Permit {job.permitStatus.replace(/_/g, " ")}
                      </Badge>
                    ) : null}
                  </div>
                  <p className="text-muted-foreground mt-2 text-sm leading-relaxed">
                    {[job.name, job.address].filter(Boolean).join(" · ") ||
                      "No description yet"}
                  </p>
                  <TagBadges tags={recordTags[job.id] ?? []} />
                </div>
              </div>
              {job.demo ? (
                <p className="text-muted-foreground shrink-0 text-sm">
                  Not counted in your money
                </p>
              ) : (
                <div className={styles.rowMoney}>
                  <Figure label="Total" cents={job.money.totalCents} />
                  <Figure label="Collected" cents={job.money.collectedCents} />
                  <Figure label="Remaining" cents={job.money.remainingCents} />
                </div>
              )}
              <ArrowUpRight className={styles.rowArrow} size={17} aria-hidden="true" />
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}

function Figure({ label, cents }: { label: string; cents: number }) {
  return (
    <div>
      <p className="text-muted-foreground text-xs">{label}</p>
      <p className="mt-1 font-medium tabular-nums break-words">{formatMoney(cents)}</p>
    </div>
  );
}
