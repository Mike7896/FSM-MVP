import { TagFilters, TagBadges } from "@/components/tags/tag-controls";
import { listTags, tagsForRecords } from "@/lib/queries/tags";
import { parseTagFilter } from "@/lib/tags";
import Link from "next/link";
import type { Metadata } from "next";

import { getAccess } from "@/lib/membership/access";
import { LayoutGrid, List, Search } from "lucide-react";

import { DemoChip } from "@/components/demo-chip";
import { DocumentCard, DocumentShelf } from "@/components/documents/document-card";
import { PageHeader } from "@/components/page-header";
import { Badge } from "@/components/ui/badge";
import { RecordList, RecordRow, RecordMetric } from "@/components/record-list";
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
import { listQuotePreviews, listQuotes } from "@/lib/queries/quotes";
import { getOfficeIdentity } from "@/lib/queries/office";
import { formatMoney, type QuoteDraft } from "@/lib/quote";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "Quotes" };

/**
 * Browse, search, duplicate.
 *
 * **The default view is the shelf, and each document is drawn as a document.**
 * A product whose whole subject is paper had been representing each piece of it
 * as a table row with a name and a chevron — which is what every list in every
 * app looks like, and tells a contractor nothing about *which* quote he is
 * looking at. A miniature of the real page does, because that is how anyone
 * recognises their own document: by its shape and its first few lines, long
 * before they have read the name.
 *
 * **The list stays**, behind `?view=list`, because the two views answer
 * different questions. The shelf answers *which one is the Henderson job*; the
 * list answers *which of these fifty is the biggest, and which went quiet*.
 * Neither is a worse version of the other, and a product that ships only the
 * pretty one has traded scanning for recognition without being asked.
 *
 * `Viewed` is a status the contractor cares about disproportionately — it is
 * the difference between "they haven't looked" and "they looked and went
 * quiet" — so it is never merged into `Sent`.
 *
 * The search box matches **line text as well as titles and customers**, which
 * is the point of the list: it is how a contractor finds the last time they
 * priced similar work.
 */

const STATUS_VARIANT: Record<
  QuoteDraft["status"],
  "default" | "secondary" | "outline" | "destructive"
> = {
  draft: "outline",
  sent: "secondary",
  viewed: "default",
  accepted: "default",
  declined: "destructive",
  expired: "outline",
};

const RELATIVE = new Intl.RelativeTimeFormat("en", { numeric: "auto" });

/** "5 days ago" reads the way a contractor thinks about a quote's age. */
function ago(date: Date | null): string {
  if (!date) return "—";
  const days = Math.round((date.getTime() - Date.now()) / 86_400_000);
  if (days > -1) return "Today";
  if (days > -31) return RELATIVE.format(days, "day");
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

/**
 * What he is actually waiting on, in one line.
 *
 * A draft is waiting on him; everything else is waiting on her, and *opened* is
 * the fact worth surfacing — it is the one thing a spreadsheet could never tell
 * him and the one that decides whether a call is worth making.
 */
function standing(quote: {
  status: QuoteDraft["status"];
  sentAt: Date | null;
  viewedAt: Date | null;
  createdAt: Date;
}): string {
  if (quote.status === "draft") return `Started ${ago(quote.createdAt)}`;
  if (quote.viewedAt) return `Opened ${ago(quote.viewedAt)}`;
  if (quote.sentAt) return `Sent ${ago(quote.sentAt)}`;
  return ago(quote.createdAt);
}

export default async function QuotesPage({
  searchParams,
}: PageProps<"/quotes">) {
  const org = await requireActiveOrganization();
  const filters = parseTagFilter(await searchParams);
  const { q, view } = await searchParams;

  const search = typeof q === "string" && q.trim() ? q.trim() : undefined;
  const asList = view === "list";

  const [listed, office, { features }] = await Promise.all([
    listQuotes(org.id, { ...filters, q: search, limit: 50, offset: 0 }),
    getOfficeIdentity(org.id),
    getAccess(org.id),
  ]);

  // "Viewed" is quote-view tracking, a Pro feature (Billing §2.2): below Pro
  // a viewed quote reads as what the contractor did — sent.
  const quotes = features.viewTracking
    ? listed
    : listed.map((quote) => (quote.status === "viewed" ? { ...quote, status: "sent" as const } : quote));

  // Only the shelf needs the page contents, so the list view never pays for
  // them.
  const previews = asList
    ? new Map<string, never[]>()
    : await listQuotePreviews(quotes.map((quote) => quote.id));

  const query = (next: Record<string, string | undefined>) => {
    const params = new URLSearchParams();
    if (search) params.set("q", search);
    if (filters.tags) params.set("tags", filters.tags);
    if (filters.tagMode) params.set("tagMode", filters.tagMode);
    for (const [key, value] of Object.entries(next)) {
      if (value) params.set(key, value);
      else params.delete(key);
    }
    const string = params.toString();
    return string ? `/quotes?${string}` : "/quotes";
  };

  const [availableTags, recordTags] = await Promise.all([listTags(org.id), tagsForRecords(org.id, "quote", quotes.map(row => row.id))]);
  return (
    <div className="mx-auto flex w-full max-w-(--workspace-max-width) flex-col gap-10">
      <PageHeader
        title="Quotes"
        description="Every priced document you've sent, and where it stands."
      />

      <div className="-mb-4 flex flex-wrap items-center justify-between gap-3">
        {/* A GET form, so a search is a URL — shareable, back-button-safe, and
            working before the JavaScript has loaded. */}
        <form className="relative max-w-sm flex-1">
          {filters.tags && <input type="hidden" name="tags" value={filters.tags} />}
          {filters.tagMode && <input type="hidden" name="tagMode" value={filters.tagMode} />}
          <Search className="text-muted-foreground pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2" />
          <Input
            name="q"
            aria-label="Search quotes"
            defaultValue={search ?? ""}
            placeholder="Customer, address, or a line you priced before"
            className="pl-8"
          />
          {asList ? <input type="hidden" name="view" value="list" /> : null}
        </form>

        {/* Links rather than buttons: the view is in the URL, so it survives a
            reload and a shared link, and it works with no JavaScript. */}
        <div className="flex items-center rounded-md border p-0.5">
          <ViewLink href={query({ view: undefined })} active={!asList} label="Shelf">
            <LayoutGrid className="size-3.5" />
          </ViewLink>
          <ViewLink href={query({ view: "list" })} active={asList} label="List">
            <List className="size-3.5" />
          </ViewLink>
        </div>
      </div>

      <TagFilters organizationId={org.id} available={availableTags} />

      {quotes.length === 0 ? (
        <Empty>
          <EmptyHeader>
            <EmptyTitle>
              {(search || filters.tags || filters.tagMode === "untagged") ? "Nothing matched that." : "No quotes yet"}
            </EmptyTitle>
            <EmptyDescription>
              {(search || filters.tags || filters.tagMode === "untagged")
                ? "Try changing the search or clearing the tag filters."
                : "Quotes you send land here, with their status."}
            </EmptyDescription>
          </EmptyHeader>
          <EmptyContent>
            <Button asChild>
              <Link href="/quotes/new">New quote</Link>
            </Button>
          </EmptyContent>
        </Empty>
      ) : asList ? (
        <RecordList title={search || filters.tags || filters.tagMode === "untagged" ? "Search results" : "All quotes"} count={quotes.length}>
          {quotes.map((quote) => (
            <RecordRow
              key={quote.id}
              href={quote.sentAt ? `/quotes/${quote.id}/sent` : `/quotes/${quote.id}`}
              kind="quote"
              title={quote.customerName}
              reference={`#${quote.number}`}
              description={quote.title ?? "Untitled"}
              badges={<><Badge variant="secondary" className={cn("gap-1.5 rounded-full border-0 px-2.5 py-0.5 capitalize", quote.status === "accepted" ? "bg-positive/12 text-positive" : quote.status === "declined" ? "bg-destructive/10 text-destructive" : quote.status === "viewed" ? "bg-primary/15 text-primary-ink" : "bg-muted text-muted-foreground")}><span className="size-1.5 rounded-full bg-current" aria-hidden="true" />{quote.status}</Badge>{quote.demo ? <DemoChip /> : null}</>}
              tags={<TagBadges tags={recordTags[quote.id] ?? []} />}
              metrics={<>
                <RecordMetric label="Sent">{ago(quote.sentAt)}</RecordMetric>
                <RecordMetric label="Activity">{standing({ ...quote, viewedAt: features.viewTracking ? quote.viewedAt : null })}</RecordMetric>
                <RecordMetric label="Total">{formatMoney(Number(quote.totalCents))}</RecordMetric>
              </>}
            />
          ))}
        </RecordList>
      ) : (
        <DocumentShelf>
          {quotes.map((quote) => (
            <div key={quote.id} className="min-w-0">
            <DocumentCard
              // A sent quote opens where it stands — sent, opened, approved —
              // the way the dashboard's does; the quote is one click from there.
              href={quote.sentAt ? `/quotes/${quote.id}/sent` : `/quotes/${quote.id}`}
              businessName={office.businessName}
              license={office.license}
              customerName={quote.customerName}
              title={quote.title}
              number={quote.number}
              rows={previews.get(quote.id) ?? []}
              totalCents={Number(quote.totalCents)}
              status={quote.status}
              statusVariant={STATUS_VARIANT[quote.status]}
              standing={standing(quote)}
              demo={quote.demo}
            />
            <div className="mt-2"><TagBadges tags={recordTags[quote.id] ?? []} /></div>
            </div>
          ))}
        </DocumentShelf>
      )}
    </div>
  );
}

function ViewLink({
  href,
  active,
  label,
  children,
}: {
  href: string;
  active: boolean;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <Link
      href={href}
      aria-label={label}
      aria-current={active ? "true" : undefined}
      className={cn(
        "flex size-7 items-center justify-center rounded transition-colors",
        active
          ? "bg-muted text-foreground"
          : "text-muted-foreground hover:text-foreground"
      )}
    >
      {children}
    </Link>
  );
}
