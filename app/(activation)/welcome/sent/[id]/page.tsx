import type { Metadata } from "next";

import { SentPage } from "@/components/quote-send/sent-page";

export const metadata: Metadata = { title: "Sent" };

/** Screen 11 at the end of Journey 0 — or, on a demo, the handoff (15a). */
export default async function WelcomeSentPage({
  params,
}: PageProps<"/welcome/sent/[id]">) {
  const { id } = await params;
  return <SentPage quoteId={id} place="activation" />;
}
