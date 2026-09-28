import type { Metadata } from "next";

import { SignupForm } from "@/components/auth/signup-form";

export const metadata: Metadata = { title: "Create an account" };

/**
 * A trade door (`/for/[trade]`) links here with `?trade=`, and it rides through
 * signup to the first screen after it — so the one question that door already
 * answered is never asked again (16a).
 */
export default async function SignupPage({
  searchParams,
}: PageProps<"/signup">) {
  const { trade } = await searchParams;
  const next =
    typeof trade === "string" && /^[a-z-]{1,40}$/.test(trade)
      ? `/welcome?trade=${trade}`
      : "/welcome";

  return <SignupForm next={next} />;
}
