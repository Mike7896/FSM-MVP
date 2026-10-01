import "server-only";

import { ConnectorError } from "../oauth";
import type { ClaimedJob } from "../queue";

/**
 * QuickBooks entity mappers — **signatures now, bodies when the sync ships.**
 *
 * The brief phases the sync itself into Expansion; what ships at launch is the
 * event-shaped money log it will replay from. These live here so the queue has
 * something typed to dispatch to, so the operation names are fixed before
 * anything starts enqueueing them, and so the hard decisions are written down
 * where the code that has to honour them will be.
 *
 * Each one throws rather than silently doing nothing. A mapper that returned
 * success without pushing would mark a row `succeeded`, and the contractor
 * would be told their books are current when nothing has been sent — which is
 * the exact failure mode the sync-health surface exists to prevent.
 *
 * ## The decisions these have to honour
 *
 * **One-way, always.** App → QuickBooks. Never pull their edits back. Two-way
 * conflict resolution is where accounting integrations die, and one-way covers
 * roughly ninety per cent of the value, which is "no double entry".
 *
 * **Do not explode their chart of accounts.** Rich trade line items map *down*
 * to a few income categories — labor, materials, equipment, permits —
 * configurable per contractor or their accountant. A sync that creates a
 * QuickBooks service item per line item makes their books unusable and their
 * accountant an enemy.
 *
 * **Deposits are a liability, not income.** Money received before an invoice
 * exists posts to a customer-deposit liability account; the invoice applies it
 * as a credit; the liability unwinds as revenue is earned. A cancelled job
 * refunds *from the liability*, not as an income reversal. This is the flow
 * generic syncs get wrong and the one worth demoing to bookkeepers.
 *
 * **Book payments gross, with the processing fee as its own expense line.**
 * Netting the fee into revenue understates income and hides a real cost, and
 * accountants ask for gross. Where a processor batches payouts, the batch lands
 * in a clearing account rather than being guessed at.
 *
 * **Never delete in QuickBooks.** A mistake is corrected with a credit memo or
 * a void, both of which are accounting acts with their own records.
 */

export type PushContext = {
  organizationId: string;
  /** The QuickBooks company. Every API path is scoped by it. */
  realmId: string;
  /** A live bearer token; refresh has already happened if it was needed. */
  accessToken: string;
  /** Re-sent verbatim on a retry, which is what makes a retry safe. */
  idempotencyKey: string;
};

export type PushResult = {
  /** The QuickBooks id, stored on `external_refs` so the next push updates. */
  remoteId: string;
  /** QuickBooks' optimistic-concurrency token. Required on every update. */
  remoteVersion: string | null;
};

type Mapper = (job: ClaimedJob, context: PushContext) => Promise<PushResult>;

function notYet(what: string): Mapper {
  return async () => {
    throw new ConnectorError(
      "config",
      `The QuickBooks ${what} sync isn't built yet. Nothing was sent.`
    );
  };
}

/**
 * Match or create a QuickBooks customer.
 *
 * Dedupe on email plus name before creating — a sync that creates a second
 * "Jean Petersen" is one the contractor has to clean up by hand, and they will
 * blame the app rather than the match rule. The resulting id goes on
 * `external_refs` so every later push addresses the same record.
 */
export const pushCustomer: Mapper = notYet("customer");

/**
 * Push an invoice, carrying our number and our line items.
 *
 * Milestone invoices map to QuickBooks **progress invoicing**. A deposit
 * already collected against the job applies here as a credit from the
 * customer-deposit liability account rather than appearing as a discount, which
 * is what keeps the invoice total and the agreed price in agreement.
 */
export const pushInvoice: Mapper = notYet("invoice");

/**
 * Push a payment against an invoice.
 *
 * Gross, with the processing fee as a separate expense line where there is one.
 * A payment the contractor recorded by hand — cash, a cheque, a Zelle transfer
 * — posts exactly the same way as one that arrived on a connected processor:
 * the money moved either way, and the books do not care which rail carried it.
 */
export const pushPayment: Mapper = notYet("payment");

/**
 * Post a deposit to the customer-deposit liability account.
 *
 * The hard one, and the differentiating one. Sensible default account created
 * on connect, overridable by the accountant.
 */
export const pushDeposit: Mapper = notYet("deposit");

/** A refund flows from the liability account, never as an income reversal. */
export const pushRefund: Mapper = notYet("refund");

/** The queue dispatches on `operation`; unknown ones are a programming error. */
export const QUICKBOOKS_OPERATIONS: Record<string, Mapper> = {
  push_customer: pushCustomer,
  push_invoice: pushInvoice,
  push_payment: pushPayment,
  push_deposit: pushDeposit,
  push_refund: pushRefund,
};
