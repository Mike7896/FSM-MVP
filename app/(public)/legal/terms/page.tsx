import type { Metadata } from "next";

export const metadata: Metadata = { title: "Terms of service" };

/**
 * Linked in the footer and at checkout.
 *
 * Placeholder structure only — the actual terms are a legal deliverable, not a
 * design one, and writing plausible-looking legal text here would be worse than
 * an obvious stub.
 */
export default function TermsPage() {
  return (
    <div className="mx-auto w-full max-w-2xl px-4 py-16 sm:px-6">
      <h1 className="text-3xl font-semibold tracking-tight">
        Terms of service
      </h1>
      <p className="text-muted-foreground mt-3 text-sm">
        Not yet written. This page exists so the footer and checkout links
        resolve.
      </p>

      <div className="mt-10 flex flex-col gap-6">
        {[
          "Who this agreement is between",
          "What the service does",
          "Your account and your data",
          "Payments, plans and trade packs",
          "Payment processing and your customers' money",
          "Cancellation and what happens to jobs in flight",
          "Limits of liability",
          "Changes to these terms",
        ].map((heading) => (
          <section key={heading}>
            <h2 className="font-medium">{heading}</h2>
            <p className="text-muted-foreground mt-1 text-sm">
              To be drafted with counsel.
            </p>
          </section>
        ))}
      </div>
    </div>
  );
}
