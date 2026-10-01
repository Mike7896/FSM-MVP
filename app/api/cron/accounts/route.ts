import { NextResponse, type NextRequest } from "next/server";

import { endExpiredTesters } from "@/lib/admin/accounts";
import { refuseUnlessCron } from "@/lib/api/cron";
import { runMembershipSweep } from "@/lib/membership/sweep";

/**
 * `POST /api/cron/accounts` — end tester access that has run out.
 *
 * Hourly (`vercel.json`). A tester whose last day has passed is suspended,
 * with "Tester access ended <date>" as the reason, so the admin panel says why
 * and lifting it is one click if they're given more time.
 *
 * Also runs the membership sweep (Billing §3.2, §5.3): dunning and evaluation
 * reminders, the day-30 write-off, and reconciliation of anything Stripe's
 * webhooks missed. Access itself never waits on this — it is derived from
 * timestamps when read — so a late or skipped run only delays a notice.
 */
export async function POST(request: NextRequest) {
  const refused = refuseUnlessCron(request);
  if (refused) return refused;
  const [ended, membership] = await Promise.all([
    endExpiredTesters(),
    runMembershipSweep(),
  ]);
  return NextResponse.json({ ended, membership });
}

export const GET = POST;
