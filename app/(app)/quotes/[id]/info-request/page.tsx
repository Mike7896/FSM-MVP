import { notFound } from "next/navigation";
import { eq } from "drizzle-orm";
import { PageHeader } from "@/components/page-header";
import { InfoRequestForm } from "@/components/jobs/info-request-form";
import { requireActiveOrganization, verifySession } from "@/lib/dal";
import { db } from "@/lib/db";
import { customers } from "@/lib/db/schema";
import { emailConfigured } from "@/lib/email/send";
import { requireInfoQuote, listInfoRequests } from "@/lib/field/info-requests";
import { DomainError } from "@/lib/errors";
export const metadata = { title: "Ask for info" };
export default async function InfoRequestPage({ params }: PageProps<"/quotes/[id]/info-request">) {
  const org = await requireActiveOrganization();
  const { id } = await params;
  const quote = await requireInfoQuote(id, org.id).catch(error => {
    if (error instanceof DomainError && error.kind === "not_found") notFound();
    throw error;
  });
  const [customer] = quote.customerId ? await db.select({ email: customers.email }).from(customers).where(eq(customers.id, quote.customerId)) : [];
  const session = await verifySession();
  return <div className="mx-auto flex w-full max-w-2xl flex-col gap-8">
    <PageHeader title="Ask for what's missing" description="Your customer answers from the quote link. No account needed." />
    <InfoRequestForm quoteId={id} customerEmail={quote.demo ? session?.email ?? "" : customer?.email ?? ""} emailEnabled={emailConfigured()} history={await listInfoRequests(id)} />
  </div>;
}
