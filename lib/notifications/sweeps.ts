import "server-only";

import { and, eq, isNull, lt, notInArray, sql } from "drizzle-orm";

import { db } from "@/lib/db";
import { documents, invoiceDetails, jobs, licenses } from "@/lib/db/schema";
import { collectedForInvoice } from "@/lib/ledger";

import {
  DEFAULT_RENEWAL_REMINDER_DAYS,
  LICENSE_LOOKBACK_DAYS,
} from "./compose";
import { notify } from "./notify";

/**
 * The notifications nothing happens to trigger.
 *
 * An invoice does nothing when it goes overdue, and a license does nothing when
 * its renewal window opens — time passes, and that is the event. So these are
 * found by looking, every cron run, and the dedupe key is what stops "found
 * again" from becoming "told again".
 *
 * Each sweep only picks up what hasn't been told yet, so a run is cheap once
 * the backlog is clear — and one whose notification failed to write is simply
 * found again next time.
 */

/** Enough for a day's backlog in one run, without crowding out the sends. */
const SWEEP_LIMIT = 100;

const DOCUMENT_ID = sql.raw('"documents"."id"');
const DOCUMENT_ORG = sql.raw('"documents"."organization_id"');

export async function runSweeps() {
  return {
    overdueInvoices: await sweepOverdueInvoices(),
    licenseRenewals: await sweepLicenseRenewals(),
  };
}

async function sweepOverdueInvoices(): Promise<number> {
  const today = new Date().toISOString().slice(0, 10);

  const due = await db
    .select({ id: documents.id, organizationId: documents.organizationId })
    .from(documents)
    .innerJoin(invoiceDetails, eq(invoiceDetails.documentId, documents.id))
    .innerJoin(jobs, eq(documents.jobId, jobs.id))
    .where(
      and(
        eq(documents.type, "invoice"),
        notInArray(documents.status, ["draft", "paid", "void"]),
        isNull(invoiceDetails.voidedAt),
        lt(invoiceDetails.dueOn, today),
        eq(jobs.isDemo, false),
        sql`${invoiceDetails.amountDueCents} > ${collectedForInvoice(DOCUMENT_ID)}`,
        sql`not exists (
          select 1 from notifications n
          where n.organization_id = ${DOCUMENT_ORG}
            and n.dedupe_key = 'invoice.overdue:' || ${DOCUMENT_ID}
        )`
      )
    )
    .limit(SWEEP_LIMIT);

  let told = 0;
  for (const invoice of due) {
    told += await notify(
      {
        kind: "invoice.overdue",
        organizationId: invoice.organizationId,
        documentId: invoice.id,
      },
      { deliverNow: false }
    );
  }
  return told;
}

async function sweepLicenseRenewals(): Promise<number> {
  const due = await db
    .select({ id: licenses.id, organizationId: licenses.organizationId })
    .from(licenses)
    .where(
      and(
        sql`${licenses.expiresOn} <= current_date + coalesce(${licenses.renewalReminderDays}, ${DEFAULT_RENEWAL_REMINDER_DAYS}::int)`,
        sql`${licenses.expiresOn} >= current_date - ${LICENSE_LOOKBACK_DAYS}::int`,
        sql`not exists (
          select 1 from notifications n
          where n.organization_id = "licenses"."organization_id"
            and n.dedupe_key = 'license.renewal:' || "licenses"."id" || ':' || "licenses"."expires_on"::text
        )`
      )
    )
    .limit(SWEEP_LIMIT);

  let told = 0;
  for (const license of due) {
    told += await notify(
      {
        kind: "license.renewal",
        organizationId: license.organizationId,
        licenseId: license.id,
      },
      { deliverNow: false }
    );
  }
  return told;
}
