import { NextResponse, type NextRequest } from "next/server";

import { endExpiredTesters } from "@/lib/admin/accounts";
import { refuseUnlessCron } from "@/lib/api/cron";

/**
 * `POST /api/cron/accounts` — end tester access that has run out.
 *
 * Hourly (`vercel.json`). A tester whose last day has passed is suspended,
 * with "Tester access ended <date>" as the reason, so the admin panel says why
 * and lifting it is one click if they're given more time.
 */
export async function POST(request: NextRequest) {
  const refused = refuseUnlessCron(request);
  if (refused) return refused;
  return NextResponse.json({ ended: await endExpiredTesters() });
}

export const GET = POST;
