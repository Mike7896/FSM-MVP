import type { Metadata } from "next";

import { SentPage } from "@/components/quote-send/sent-page";

export const metadata: Metadata = { title: "Sent" };

/** Screen 11 inside the app — where a sent quote stands. */
export default async function QuoteSentPage({
  params,
}: PageProps<"/quotes/[id]/sent">) {
  const { id } = await params;
  return <SentPage quoteId={id} place="app" />;
}
