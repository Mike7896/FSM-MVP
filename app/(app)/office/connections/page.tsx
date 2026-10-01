import type { Metadata } from "next";

import { ConnectionCard } from "@/components/office/connection-card";
import { PageHeader } from "@/components/page-header";
import { KIND_LABELS, KIND_ORDER } from "@/lib/connectors";
import { requireActiveOrganization } from "@/lib/dal";
import { listConnections } from "@/lib/queries/connections";

export const metadata: Metadata = { title: "Connections" };

/**
 * Connections · job O3. Wireframe 94 · the Office.
 *
 * A hub of low-frequency, high-trust moments, each with the same shape: *enter
 * with mild dread → clear guided flow → visible confirmation of health.*
 *
 * ## The rule this page is built on: integrate, don't change
 *
 * A one-truck shop already gets paid somehow and already keeps books somewhere.
 * Requiring a new merchant account to use the product puts a barrier in front
 * of exactly the customer it is for — so nothing here asks a contractor to
 * change how money reaches them.
 *
 * That is why **taking cards is a slot a contractor can leave empty**. A shop
 * paid by cheque, cash and Zelle connects nothing in that row, sends quotes,
 * gets paid, and still has a complete money record. The pay button on the
 * homeowner's link is simply absent, and their own payment instructions appear
 * instead.
 *
 * It is also why **Zelle, Venmo and Cash App are named in the copy but are not
 * connectors**. None of them exposes an API a third party can read a personal
 * account through — Zelle has no developer programme at all, and Venmo and Cash
 * App can only be *accepted* through a merchant account, which is the barrier
 * we are refusing to put up. Money that arrives those ways is either recorded
 * by the contractor or matched from the bank feed, and both are first-class.
 *
 * ## What the trust requirement demands
 *
 * *"Will it mess up my books?"* is answered **before** connecting, not after,
 * and the accountant is a real purchase influencer. A sync that dumps deposits
 * as income is a churn driver, so what each connector reads and writes is
 * stated on this page in the contractor's language.
 */
export default async function ConnectionsPage() {
  const org = await requireActiveOrganization();
  const rows = await listConnections(org.id);

  return (
    <div className="flex flex-col gap-8">
      <PageHeader
        title="Connections"
        description="What this app is allowed to read and write somewhere else."
      />

      {KIND_ORDER.map((kind) => {
        const inKind = rows.filter((row) => row.connector.kind === kind);
        if (inKind.length === 0) return null;

        const label = KIND_LABELS[kind];

        return (
          <section key={kind} className="flex flex-col gap-3">
            <div>
              <h2 className="font-label text-[11px] uppercase">
                {label.title}
              </h2>
              <p className="text-muted-foreground mt-1 text-sm">
                {label.detail}
              </p>
            </div>

            {inKind.map((row) => (
              <ConnectionCard key={row.connector.id} row={row} />
            ))}

            {/* The honest note under the processor slot, and the reason the
                slot is optional at all. Naming the rails we cannot connect is
                better than a contractor hunting for a Zelle button that a
                third party is not permitted to build. */}
            {kind === "processor" ? (
              <p className="text-muted-foreground rounded-xl border border-dashed p-5 text-sm">
                <strong className="text-foreground font-medium">
                  Getting paid by cheque, cash, Zelle or Venmo? Connect nothing
                  here.
                </strong>{" "}
                Those don&apos;t let an app like this one see them — so you
                record the payment when it lands, or connect your bank above and
                we&apos;ll spot the deposit and match it to the invoice it pays.
                Either way the job&apos;s money is right and your books get the
                same entry.
              </p>
            ) : null}
          </section>
        );
      })}
    </div>
  );
}
