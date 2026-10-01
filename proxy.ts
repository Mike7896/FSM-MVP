import type { NextRequest } from "next/server";

import { updateSession } from "@/lib/supabase/proxy";

/**
 * Next.js 16 renamed the `middleware` file convention to `proxy`; the exported
 * function must be named `proxy`. Runs on the Node.js runtime by default.
 */
export async function proxy(request: NextRequest) {
  return updateSession(request);
}

export const config = {
  matcher: [
    /*
     * Every path except static assets and image files. Auth cookies must be
     * refreshed on normal navigations, but running this on `_next/static` would
     * add latency to every asset and can block CSS/JS from loading.
     *
     * Four paths are excluded deliberately, and all four for the same reason:
     * nothing behind them carries a session, so a redirect to /login turns a
     * working machine-to-machine call into an HTML page the caller cannot read.
     *
     * - `api/stripe/webhook` and `api/stripe/connect/webhook` — authenticated
     *   by Stripe's signature, on two separate signing secrets;
     * - `api/webhooks/*` — the connector receivers, each verified by its own
     *   provider's signature or verifier token;
     * - `api/cron/*` — invoked by Vercel Cron with a bearer secret;
     * - `monitoring` — the Sentry tunnel route set in next.config.ts.
     *
     * The OAuth *callbacks* under `api/connections` are deliberately **not**
     * excluded: they finish a handshake a signed-in contractor started, and the
     * session is exactly what proves the person completing it is the person who
     * began it.
     */
    "/((?!_next/static|_next/image|favicon.ico|api/stripe/webhook|api/stripe/connect/webhook|api/webhooks|api/cron|monitoring|.*\.(?:svg|png|jpg|jpeg|gif|webp|avif|ico|woff2?)$).*)",
  ],
};
