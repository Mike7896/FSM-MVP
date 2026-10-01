import Link from "next/link";
import type { Metadata } from "next";

import { ResetPasswordForm } from "@/components/auth/reset-password-form";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  EMAIL_LINK_PROOF_MINUTES,
  signedInByEmailLinkRecently,
  verifySession,
} from "@/lib/dal";

export const metadata: Metadata = { title: "Set a new password" };

/**
 * Where a reset link lands, once `/auth/confirm` has signed the session in.
 *
 * **The page checks the same proof the endpoint does**, so a contractor never
 * fills in a form the server is going to refuse. Arriving without a fresh
 * email-link session — typed the address, came back tomorrow — shows the way
 * to a new link instead.
 */
export default async function ResetPasswordPage() {
  const session = await verifySession();
  const proven = session ? await signedInByEmailLinkRecently() : false;

  if (!session || !proven) {
    return (
      <Card className="w-full max-w-sm [--card-spacing:--spacing(6)]">
        <CardHeader>
          <CardTitle>This reset link has run out</CardTitle>
          <CardDescription>
            A reset link works once, for {EMAIL_LINK_PROOF_MINUTES} minutes
            after you open it. Send yourself a new one.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Button asChild className="w-full">
            <Link href="/forgot-password">Send a new link</Link>
          </Button>
        </CardContent>
      </Card>
    );
  }

  return <ResetPasswordForm email={session.email} />;
}
