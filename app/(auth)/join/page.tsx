import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { ResetPasswordForm } from "@/components/auth/reset-password-form";
import { signedInByEmailLinkRecently, verifySession } from "@/lib/dal";

export const metadata: Metadata = { title: "Choose a password" };

/**
 * Straight after accepting an invite: choose a password, then on to setting up
 * the business (the dashboard sends anyone without one to /welcome).
 *
 * The invite's sign-in counts as the email-link proof the password endpoint
 * asks for, for the same half hour a reset link gets. Past that — or arriving
 * any other way — there's nothing to do here.
 */
export default async function JoinPage() {
  const session = await verifySession();
  if (!session || !(await signedInByEmailLinkRecently())) redirect("/dashboard");

  return (
    <ResetPasswordForm
      email={session.email}
      title="Choose a password"
      submitLabel="Save and continue"
      successMessage="You're in. Next, tell us about your business."
      skipHref="/dashboard"
    />
  );
}
