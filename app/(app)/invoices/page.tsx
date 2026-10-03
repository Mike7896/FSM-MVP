import Link from "next/link";
import type { Metadata } from "next";

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
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { requireActiveOrganization } from "@/lib/dal";
import { invoiceSummary, listInvoices } from "@/lib/queries/invoices";
import { formatMoney } from "@/lib/quote";

export const metadata: Metadata = { title: "Invoices" };

/**
 * The invoice list · money owed and collected.
 *
 * Deposit, draw and final balance are one object with a type attribute — three
 * moments of the same thing — so they list together rather than in three
 * places.
 *
 * **Status here is derived, not read off the row.** Whether an invoice is
 * overdue depends on today's date, and whether it is paid depends on the
 * payments against it. Storing either would need something to keep it true, and
 * the first night that job failed this list would be wrong about who owes
 * money.
 */

const STATUS_VARIANT: Record<
  string,
  "default" | "secondary" | "outline" | "destructive"
> = {
  draft: "outline",
  issued: "secondary",
  sent: "secondary",
  viewed: "secondary",
  processing: "secondary",
  paid: "default",
  overdue: "destructive",
  void: "outline",
};

export default async function InvoicesPage() {
  const org = await requireActiveOrganization();
  const [invoices, summary] = await Promise.all([
    listInvoices(org.id),
    // Its own query: the list is paginated, and a header that totals only the
    // first page understates the debt as soon as a shop gets busy.
    invoiceSummary(org.id),
  ]);

  return (
    <div className="mx-auto flex w-full max-w-(--workspace-max-width) flex-col gap-10">
      <PageHeader
        title="Invoices"
        description={
          summary.openCount === 0
            ? "Nothing outstanding."
            : `${formatMoney(summary.outstandingCents)} outstanding across ${summary.openCount} invoice${summary.openCount === 1 ? "" : "s"}${
                summary.overdueCount > 0
                  ? ` · ${summary.overdueCount} past due`
                  : ""
              }.`
        }
        actions={
          <Button asChild variant="outline">
            <Link href="/invoices/new">New invoice</Link>
          </Button>
        }
      />

      {invoices.length === 0 ? (
        <Empty>
          <EmptyHeader>
            <EmptyTitle>No invoices yet</EmptyTitle>
            <EmptyDescription>
              A deposit is invoiced when a quote is signed, and draws follow the
              work. Most invoices here will have made themselves.
            </EmptyDescription>
          </EmptyHeader>
          <EmptyContent>
            <Button asChild>
              <Link href="/quotes/new">Write a quote</Link>
            </Button>
          </EmptyContent>
        </Empty>
      ) : (
        <div className="overflow-x-auto rounded-lg border bg-card">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-20">Number</TableHead>
                <TableHead>Customer</TableHead>
                <TableHead>Covers</TableHead>
                <TableHead>Type</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Due</TableHead>
                <TableHead className="text-right">Outstanding</TableHead>
                <TableHead className="w-20" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {invoices.map((invoice) => (
                <TableRow key={invoice.id} className="dark:hover:bg-muted">
                  <TableCell className="text-xs tabular-nums">
                    {invoice.number}
                  </TableCell>
                  <TableCell className="font-medium">
                    {invoice.customerName}
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {invoice.covers ?? "—"}
                  </TableCell>
                  <TableCell className="text-muted-foreground capitalize">
                    {invoice.type.replace(/_/g, " ")}
                  </TableCell>
                  <TableCell>
                    <Badge
                      variant={STATUS_VARIANT[invoice.effectiveStatus] ?? "outline"}
                      className="capitalize"
                    >
                      {invoice.effectiveStatus}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-muted-foreground text-sm">
                    {invoice.daysPastDue > 0
                      ? `${invoice.daysPastDue}d past due`
                      : (invoice.dueOn ?? "—")}
                  </TableCell>
                  <TableCell className="text-right font-medium tabular-nums">
                    {/* What is still owed, not what was issued — a part-paid
                        invoice is not still worth its face value. */}
                    {formatMoney(invoice.outstandingCents)}
                  </TableCell>
                  <TableCell className="text-right">
                    <Button asChild variant="ghost" size="sm">
                      <Link href={`/invoices/${invoice.id}`}>Open</Link>
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}
