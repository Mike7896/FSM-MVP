"use client";

import { useState } from "react";
import { toast } from "sonner";

/**
 * Signing out, for any control that offers it.
 *
 * A full page load to /login afterwards rather than a client navigation: every
 * server-rendered screen the router is holding belongs to the session that
 * just ended, and none of it should survive into the signed-out app.
 *
 * A failed request says so and stays put. Landing on /login while the cookie
 * still works would bounce straight back into the app, which reads as the
 * button doing nothing.
 */
export function useSignOut() {
  const [pending, setPending] = useState(false);

  async function signOut() {
    setPending(true);

    const response = await fetch("/api/v1/auth/sign-out", {
      method: "POST",
    }).catch(() => null);

    if (!response?.ok) {
      setPending(false);
      toast.error("Couldn't sign you out. Check your connection and try again.");
      return;
    }

    // eslint-disable-next-line @next/next/no-location-assign-relative-destination -- a full load is the point; see above
    window.location.assign("/login");
  }

  return { signOut, pending };
}
