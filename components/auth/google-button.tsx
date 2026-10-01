"use client";

import { useEffect, useState } from "react";
import { Loader2Icon } from "lucide-react";

import { Button } from "@/components/ui/button";

/** The Google "G", in its official four colors. */
function GoogleMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 18 18" aria-hidden="true" className={className}>
      <path
        fill="#4285F4"
        d="M17.64 9.2c0-.638-.057-1.251-.164-1.84H9v3.481h4.844a4.14 4.14 0 0 1-1.796 2.716v2.259h2.908c1.702-1.567 2.684-3.875 2.684-6.615z"
      />
      <path
        fill="#34A853"
        d="M9 18c2.43 0 4.467-.806 5.956-2.18l-2.908-2.259c-.806.54-1.837.86-3.048.86-2.344 0-4.328-1.584-5.036-3.711H.957v2.332A8.997 8.997 0 0 0 9 18z"
      />
      <path
        fill="#FBBC05"
        d="M3.964 10.71A5.41 5.41 0 0 1 3.682 9c0-.593.102-1.17.282-1.71V4.958H.957A8.996 8.996 0 0 0 0 9c0 1.452.348 2.827.957 4.042l3.007-2.332z"
      />
      <path
        fill="#EA4335"
        d="M9 3.58c1.321 0 2.508.454 3.44 1.345l2.582-2.58C13.463.891 11.426 0 9 0A8.997 8.997 0 0 0 .957 4.958L3.964 7.29C4.672 5.163 6.656 3.58 9 3.58z"
      />
    </svg>
  );
}

/**
 * Starts the Google OAuth flow.
 *
 * A plain form post to `/auth/google`, which starts the flow server-side so the
 * PKCE verifier lands in a cookie `/auth/callback` can read on the way back.
 * Native rather than a fetch: the answer is a redirect to Google the browser
 * has to follow, and a native post works before the page has hydrated. `next`
 * rides along so a visitor bounced off a protected route lands back on it.
 */
export function GoogleButton({
  label = "Continue with Google",
  next,
}: {
  label?: string;
  next?: string;
}) {
  const [pending, setPending] = useState(false);

  // Back from Google's consent screen restores this page from the back-forward
  // cache, spinner and all. Without this the button stays disabled.
  useEffect(() => {
    const reset = (event: PageTransitionEvent) => {
      if (event.persisted) setPending(false);
    };
    window.addEventListener("pageshow", reset);
    return () => window.removeEventListener("pageshow", reset);
  }, []);

  return (
    <form
      method="post"
      action="/auth/google"
      className="w-full"
      onSubmit={() => setPending(true)}
    >
      {next ? <input type="hidden" name="next" value={next} /> : null}
      <Button
        type="submit"
        variant="outline"
        className="w-full"
        disabled={pending}
      >
        {pending ? (
          <>
            <Loader2Icon className="animate-spin" />
            Taking you to Google...
          </>
        ) : (
          <>
            <GoogleMark className="size-4" />
            {label}
          </>
        )}
      </Button>
    </form>
  );
}
