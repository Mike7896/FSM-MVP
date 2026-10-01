import { NextResponse, type NextRequest } from "next/server";

import { refuseUnlessCron } from "@/lib/api/cron";
import { deliverDue, runSweeps, sendDigests } from "@/lib/notifications";

/**
 * `POST /api/cron/notifications` — find what time has made true, then send
 * what's waiting.
 *
 * Every five minutes (`vercel.json`). Sweeps first, so an invoice that went
 * overdue at midnight is written and sent in the same run rather than the next;
 * deliveries second, which is also the retry for anything whose first attempt
 * failed or never ran.
 *
 * Behind the same bearer check as the sync drain — unguarded, this is a button
 * anyone could press to email every contractor at once.
 */

/** Long enough for a batch of real sends, short of the platform ceiling. */
export const maxDuration = 60;

const BATCH = 25;

export async function POST(request: NextRequest) {
  const refused = refuseUnlessCron(request);
  if (refused) return refused;

  const swept = await runSweeps();
  const delivered = await deliverDue(BATCH);
  // Last: whoever's summary hour has come gets everything held for them.
  const summaries = await sendDigests();

  return NextResponse.json({ swept, delivered, summaries });
}

/**
 * Vercel Cron sends GET on some plans and POST on others; both are the same
 * work behind the same check.
 */
export const GET = POST;
