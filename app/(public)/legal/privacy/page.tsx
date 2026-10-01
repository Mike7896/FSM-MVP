import type { Metadata } from "next";

export const metadata: Metadata = { title: "Privacy policy" };

/**
 * Linked in the footer and at checkout.
 *
 * Placeholder structure only. Worth noting for whoever drafts it: this product
 * holds a homeowner's name, address and phone number without that homeowner
 * ever having an account, which is a real thing the policy has to address.
 */
export default function PrivacyPage() {
  return (
    <div className="mx-auto w-full max-w-2xl px-4 py-16 sm:px-6">
      <h1 className="text-3xl font-semibold tracking-tight">Privacy policy</h1>
      <p className="text-muted-foreground mt-3 text-sm">
        Not yet written. This page exists so the footer and checkout links
        resolve.
      </p>

      <div className="mt-10 flex flex-col gap-6">
        {[
          "What we collect from contractors",
          "What we hold about their customers — who never sign up",
          "How share links work, and what possession of one grants",
          "Payment data and Stripe",
          "Recordings and photos captured on a walkthrough",
          "Who we share data with",
          "How long we keep things",
          "Export and deletion",
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
