import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { ChevronRight, FilePlus2, FileSignature, ImageIcon } from "lucide-react";

import { inkFor } from "@/components/documents/ink";
import { LocalTime } from "@/components/local-time";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { requireActiveOrganization } from "@/lib/dal";
import { listChangeRequests } from "@/lib/change-orders/requests";
import { agreedChangeTargets } from "@/lib/change-orders/service";
import { getJobContract, type ChangeOrderRow } from "@/lib/queries/contracts";
import { formatChange, formatMoney } from "@/lib/quote";
import { cn } from "@/lib/utils";

import styles from "../../jobs.module.css";

export const metadata: Metadata = { title: "Change orders" };

/**
 * Everything that has changed, or been asked to change, since the contract was
 * signed — one job's amendments, in one place.
 *
 * **Asked for, then priced, then answered.** A customer's request comes in from
 * their contract link and is not an approval; the contractor prices it as a
 * change order, which the customer then approves or declines. The page is laid
 * out in that order, and the money at the top says what it all adds up to: the
 * price as signed, what approved changes did to it, and what's still waiting.
 *
 * Beside it, **the work as it stands** — the signed contract with approved
 * changes applied — because "what did we agree, as of today?" is the question
 * every one of these documents is really answering.
 */
export default async function ChangeOrdersPage({
  params,
}: PageProps<"/jobs/[id]/change-orders">) {
  const org = await requireActiveOrganization();
  const { id } = await params;

  const contract = await getJobContract(id, org.id);
  if (!contract) notFound();

  const [requests, agreed] = await Promise.all([
    listChangeRequests(id, org.id),
    agreedChangeTargets(contract.id, org.id),
  ]);

  const first = firstName(contract.customerName);
  const signed = contract.status === "signed";
  // Newest first: the one he just sent is the one he's looking for.
  const orders = contract.changeOrders;
  const byId = new Map(orders.map((order) => [order.id, order]));

  const waiting = orders.filter((order) => order.status === "sent");
  const waitingCents = waiting.reduce(
    (sum, order) => sum + order.priceDeltaCents,
    0
  );
  const unpriced = requests.filter((request) => !request.changeOrderId).length;

  return (
    <div className={`@container ${styles.page}`}>
      <nav aria-label="Breadcrumb" className={styles.breadcrumb}>
        <Link href="/jobs">Jobs</Link>
        <ChevronRight size={13} />
        <Link href={`/jobs/${id}`}>Job #{contract.jobNumber}</Link>
        <ChevronRight size={13} />
        <Link href={`/jobs/${id}/contract`}>Contract</Link>
        <ChevronRight size={13} />
        <span>Change orders</span>
      </nav>

      <section className={styles.overview} aria-label="Change orders overview">
        <header className={styles.jobHeader}>
          <div className="min-w-0">
            <p className={cn(styles.eyebrow, "flex items-center gap-2")}>
              <span
                className={cn(
                  "size-1.5 rounded-full",
                  inkFor("Change order").dot
                )}
              />
              CHANGE ORDERS · AMENDS {contract.number}
            </p>
            <h1 className={styles.jobTitle}>Changes to the contract</h1>
            <div className={styles.jobMeta}>
              <Link
                href={`/customers/${contract.customerId}`}
                className={styles.customerLink}
              >
                {contract.customerName}
              </Link>
              <span>
                {orders.length === 0
                  ? "No changes yet"
                  : `${orders.length} ${orders.length === 1 ? "change" : "changes"}`}
              </span>
              {unpriced > 0 ? (
                <span className="text-foreground">
                  {unpriced} {unpriced === 1 ? "request" : "requests"} to price
                </span>
              ) : null}
            </div>
          </div>
          <div className={styles.jobIdentity}>
            <span className={styles.jobIcon} aria-hidden="true">
              <FileSignature size={25} strokeWidth={1.5} />
            </span>
          </div>
        </header>

        <div className={styles.moneyStrip}>
          <Figure label="Signed at" value={formatMoney(contract.agreedPriceCents)} />
          <Figure
            label="Approved changes"
            value={formatChange(
              contract.currentPriceCents - contract.agreedPriceCents
            )}
          />
          <Figure
            label="Contract now"
            value={formatMoney(contract.currentPriceCents)}
          />
        </div>

        {waiting.length > 0 ? (
          <p className="text-muted-foreground mt-4 text-sm">
            <span className="text-foreground font-medium tabular-nums">
              {formatChange(waitingCents)}
            </span>{" "}
            waiting on {first} across {waiting.length}{" "}
            {waiting.length === 1 ? "change" : "changes"} — not in the contract
            until they approve.
          </p>
        ) : null}

        <div className="mt-6 flex flex-wrap items-center gap-2">
          {signed ? (
            <Button asChild>
              <Link href={`/jobs/${id}/change-orders/new`}>
                <FilePlus2 />
                Write a change order
              </Link>
            </Button>
          ) : (
            <p className="text-muted-foreground text-sm">
              Change orders open once both of you have signed the contract.
            </p>
          )}
          <Button asChild variant="outline">
            <Link href={`/jobs/${id}/contract`}>Open the contract</Link>
          </Button>
        </div>
      </section>

      <div className={styles.detailGrid}>
        <div className={styles.mainColumn}>
          {/* Asked for first: it's the part waiting on him. */}
          <section className={styles.panel}>
            <div className="flex items-baseline justify-between gap-2">
              <SectionLabel>Asked for by {first}</SectionLabel>
              {requests.length > 0 ? (
                <span className="text-muted-foreground text-xs">
                  {requests.length}
                </span>
              ) : null}
            </div>
            <p className="text-muted-foreground -mt-3 mb-4 text-xs leading-relaxed">
              Sent from their contract link. A request isn&apos;t an approval —
              you price it, and they approve the priced change.
            </p>

            {requests.length === 0 ? (
              <p className="text-muted-foreground border-t py-4 text-sm">
                Nothing asked for yet. {first} can ask for a change, with
                photos, from the contract you sent them.
              </p>
            ) : (
              <ol>
                {requests.map((request) => {
                  const priced = request.changeOrderId
                    ? byId.get(request.changeOrderId)
                    : undefined;
                  const photos = request.photos.filter(
                    (url): url is string => Boolean(url)
                  );
                  return (
                    <li key={request.id} className="border-t py-4">
                      <div className="flex flex-wrap items-baseline justify-between gap-2">
                        <p className="text-muted-foreground text-xs">
                          <LocalTime
                            iso={(request.submittedAt ?? request.createdAt).toISOString()}
                          />
                        </p>
                        {request.changeOrderId ? (
                          <Badge variant="secondary">
                            Priced{priced ? ` · ${priced.number}` : ""}
                          </Badge>
                        ) : (
                          <Badge variant="outline">To price</Badge>
                        )}
                      </div>
                      <p className="mt-2 text-sm leading-relaxed whitespace-pre-wrap">
                        {request.body}
                      </p>
                      {photos.length > 0 ? (
                        <div className="mt-3 flex flex-wrap gap-2">
                          {photos.map((url, index) => (
                            <a
                              key={index}
                              href={url}
                              target="_blank"
                              rel="noreferrer"
                              className="bg-muted relative block size-20 overflow-hidden rounded-md border"
                              aria-label={`Photo ${index + 1}`}
                            >
                              <ImageIcon className="text-muted-foreground absolute inset-0 m-auto size-5" />
                              {/* eslint-disable-next-line @next/next/no-img-element -- a signed link to the customer's own photo */}
                              <img
                                src={url}
                                alt=""
                                className="relative size-full object-cover"
                              />
                            </a>
                          ))}
                        </div>
                      ) : null}
                      <div className="mt-3">
                        {request.changeOrderId ? (
                          <Button asChild size="sm" variant="outline">
                            <Link
                              href={`/jobs/${id}/change-orders/${request.changeOrderId}`}
                            >
                              Open {priced?.number ?? "the priced change"}
                            </Link>
                          </Button>
                        ) : signed ? (
                          <Button asChild size="sm">
                            <Link
                              href={`/jobs/${id}/change-orders/new?request=${request.id}`}
                            >
                              Price this request
                            </Link>
                          </Button>
                        ) : null}
                      </div>
                    </li>
                  );
                })}
              </ol>
            )}
          </section>

          <section className={styles.panel}>
            <div className="flex items-baseline justify-between gap-2">
              <SectionLabel>Change orders</SectionLabel>
              {orders.length > 0 ? (
                <span className="text-muted-foreground text-xs">
                  {orders.length}
                </span>
              ) : null}
            </div>

            {orders.length === 0 ? (
              <p className="text-muted-foreground border-t py-4 text-sm">
                None yet. When the work or the price changes after signing, it
                goes through a change order — the contract itself is never
                edited.
              </p>
            ) : (
              <ol>
                {orders.map((order) => (
                  <li key={order.id} className="border-t">
                    <Link
                      href={`/jobs/${id}/change-orders/${order.id}`}
                      className="hover:bg-muted/50 -mx-2 flex items-center gap-4 rounded-md px-2 py-3.5 transition-colors"
                    >
                      <span
                        className={cn(
                          "size-1.5 shrink-0 rounded-full",
                          inkFor("Change order").dot
                        )}
                      />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-medium">
                          {order.number} ·{" "}
                          {order.title?.trim() ||
                            order.whatChanged?.trim() ||
                            "Untitled change"}
                        </span>
                        <span className="text-muted-foreground block text-xs">
                          <Standing order={order} first={first} />
                          {order.timeImpactDays
                            ? ` · ${days(order.timeImpactDays)}`
                            : ""}
                        </span>
                      </span>
                      <Badge
                        variant={variantFor(order.status)}
                        className="hidden capitalize @md:inline-flex"
                      >
                        {order.status === "sent" ? "Waiting" : order.status}
                      </Badge>
                      <span className="w-20 shrink-0 text-right text-sm font-medium tabular-nums">
                        {formatChange(order.priceDeltaCents)}
                      </span>
                    </Link>
                  </li>
                ))}
              </ol>
            )}
          </section>
        </div>

        <aside className={styles.sideColumn}>
          <section className={styles.panel}>
            <SectionLabel>The work as it stands</SectionLabel>
            <p className="text-muted-foreground -mt-3 mb-4 text-xs leading-relaxed">
              The signed contract with approved changes applied. Changes still
              waiting aren&apos;t in it yet.
            </p>
            {agreed.length === 0 ? (
              <p className="text-muted-foreground border-t py-4 text-sm">
                No priced lines.
              </p>
            ) : (
              <ul>
                {agreed.map((line) => (
                  <li
                    key={line.id}
                    className="flex items-baseline justify-between gap-3 border-t py-2.5 text-sm"
                  >
                    <span className="min-w-0">
                      {line.description || "Untitled line"}
                      {line.allowance ? (
                        <span className="text-muted-foreground block text-xs">
                          Allowance
                        </span>
                      ) : null}
                    </span>
                    <span className="shrink-0 tabular-nums">
                      {formatMoney(line.amountCents)}
                    </span>
                  </li>
                ))}
              </ul>
            )}
            <div className="flex items-baseline justify-between gap-3 border-t pt-3">
              <span className="font-label text-[11px] uppercase">
                Contract now
              </span>
              <span className="text-lg font-semibold tabular-nums">
                {formatMoney(contract.currentPriceCents)}
              </span>
            </div>
          </section>
        </aside>
      </div>
    </div>
  );
}

/** Where one change stands, in a few words and the date that proves it. */
function Standing({ order, first }: { order: ChangeOrderRow; first: string }) {
  switch (order.status) {
    case "draft":
      return (
        <>
          Draft, not sent · started{" "}
          <LocalTime iso={order.createdAt.toISOString()} format="date" />
        </>
      );
    case "sent":
      return (
        <>
          Waiting on {first}
          {order.sentAt ? (
            <>
              {" "}
              · sent <LocalTime iso={order.sentAt.toISOString()} format="date" />
            </>
          ) : null}
        </>
      );
    case "approved":
      return (
        <>
          Approved
          {order.approvedAt ? (
            <>
              {" "}
              <LocalTime iso={order.approvedAt.toISOString()} format="date" />
            </>
          ) : null}
        </>
      );
    case "declined":
      return (
        <>
          Declined{" "}
          <LocalTime iso={order.updatedAt.toISOString()} format="date" />
        </>
      );
    default:
      return <span className="capitalize">{order.status}</span>;
  }
}

function variantFor(
  status: string
): "default" | "secondary" | "outline" | "destructive" {
  if (status === "approved") return "default";
  if (status === "sent") return "secondary";
  if (status === "declined") return "destructive";
  return "outline";
}

function days(count: number) {
  const n = Math.abs(count);
  return `${count > 0 ? "+" : "−"}${n} ${n === 1 ? "day" : "days"}`;
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return <h2 className={styles.sectionTitle}>{children}</h2>;
}

function Figure({ label, value }: { label: string; value: string }) {
  return (
    <div className={styles.figure}>
      <p className="text-muted-foreground font-label text-[10px] uppercase">
        {label}
      </p>
      <p className={styles.figureValue}>{value}</p>
    </div>
  );
}

function firstName(name: string) {
  return name.trim().split(/\s+/)[0] || "The customer";
}
