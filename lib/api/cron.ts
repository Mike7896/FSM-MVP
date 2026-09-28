import "server-only";

import { NextResponse, type NextRequest } from "next/server";

import { safeEqual } from "@/lib/connectors/crypto";
import { serverEnv } from "@/lib/env";

/**
 * The check every cron route starts with.
 *
 * Returns the refusal to send, or null when the caller is Vercel Cron. Without
 * it a cron route is an open endpoint that does its work for anyone on demand —
 * pushing to other people's books, or emailing every contractor at once.
 * Compared in constant time, because `===` leaks the secret's prefix to anyone
 * willing to send a few thousand requests.
 */
export function refuseUnlessCron(request: NextRequest): NextResponse | null {
  const { CRON_SECRET } = serverEnv();

  if (!CRON_SECRET) {
    console.error("[cron] CRON_SECRET is not set; refusing to run.");
    return NextResponse.json({ error: "Not configured" }, { status: 500 });
  }

  const offered = request.headers.get("authorization") ?? "";
  if (!safeEqual(offered, `Bearer ${CRON_SECRET}`)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  return null;
}
