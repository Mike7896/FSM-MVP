import type { Metadata } from "next";

import { SignupForm } from "@/components/auth/signup-form";
import { signupDestination } from "@/lib/membership/purchase-intent";

export const metadata: Metadata = { title: "Create an account" };

/**
 * A trade door (`/for/[trade]`) links here with `?trade=`, and it rides through
 * signup to the first screen after it — so the one question that door already
 * answered is never asked again (16a).
 */
export default async function SignupPage({
  searchParams,
}: PageProps<"/signup">) {
  const next = signupDestination(await searchParams);

  return <SignupForm next={next} />;
}
