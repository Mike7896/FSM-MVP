import Link from "next/link";
import type { Metadata } from "next";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

export const metadata: Metadata = { title: "Sign-in didn't finish" };

/**
 * Where a failed auth handshake lands.
 *
 * Content Design's error shape: what happened, what it means, and what to do —
 * never "oops", never an apology in place of information. Cancelling at Google
 * is not a failure and must not be worded like one.
 */
const REASONS: Record<string, { title: string; body: string }> = {
  cancelled: {
    title: "You cancelled at Google",
    body: "Nothing happened, and no account was created. Try again, or use your email and password instead.",
  },
  "provider-error": {
    title: "Google couldn't complete the sign-in",
    body: "That usually clears up on a second try. If it keeps happening, sign in with your email and password.",
  },
  "no-code": {
    title: "That link didn't carry a sign-in",
    body: "Sign-in links can only be used once and expire after a short while. Request a new one to continue.",
  },
  "exchange-failed": {
    title: "That sign-in couldn't be completed",
    body: "The link may have already been used, or it was opened in a different browser than the one that started it. Starting again from this browser will work.",
  },
  "oauth-start": {
    title: "Couldn't reach Google",
    body: "We couldn't start the handoff. Try again in a moment, or sign in with your email and password.",
  },
};

const FALLBACK = {
  title: "That link didn't work",
  body: "Sign-in links can only be used once and expire after a short while. Request a new one to continue.",
};

export default async function AuthCodeErrorPage({
  searchParams,
}: PageProps<"/auth/auth-code-error">) {
  const { reason } = await searchParams;
  const copy =
    (typeof reason === "string" ? REASONS[reason] : undefined) ?? FALLBACK;

  return (
    <main className="flex flex-1 items-center justify-center p-6">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle>{copy.title}</CardTitle>
          <CardDescription>{copy.body}</CardDescription>
        </CardHeader>
        <CardContent>
          <Button asChild className="w-full">
            <Link href="/login">Back to sign in</Link>
          </Button>
        </CardContent>
      </Card>
    </main>
  );
}
