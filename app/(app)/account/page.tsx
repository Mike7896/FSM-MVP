import type { Metadata } from "next";

import { BillingSummary } from "@/components/account/billing-summary";
import { PasswordForm } from "@/components/account/password-form";
import { SignOutButton } from "@/components/auth/sign-out-button";
import { PageHeader } from "@/components/page-header";
import { Badge } from "@/components/ui/badge";
import {
  getSignInMethods,
  requireActiveOrganization,
  requireSession,
} from "@/lib/dal";
import {
  getDefaultPaymentMethod,
  getSubscription,
  listReceipts,
} from "@/lib/queries/billing";
import { listPacks } from "@/lib/queries/office";

export const metadata: Metadata = { title: "Account" };

/**
 * Account — the person, and what they pay us with. Wireframe 94 · 56b.
 *
 * **One screen: sign-in and a bill.** Account is the person; the Office is the
 * business. That line is the one thing this page has to hold — a contractor
 * changing their own password is not changing anything a customer will ever
 * see, and a contractor changing the business name is changing every document
 * in flight.
 *
 * The sign-in methods are read from the auth provider on every load rather than
 * mirrored anywhere. A stale list here tells someone they can get back into
 * their account a way they cannot, which is the one error on this page that
 * costs them the product.
 */
export default async function AccountPage() {
  const session = await requireSession();
  const org = await requireActiveOrganization();

  const [methods, subscription, packs, receipts, card] = await Promise.all([
    getSignInMethods(),
    getSubscription(org.id),
    listPacks(org.id),
    listReceipts(org.id),
    getDefaultPaymentMethod(org.id),
  ]);

  const hasPassword = methods.some((method) => method.provider === "email");
  const federated = methods.filter((method) => method.provider !== "email");
  const federatedNames = federated
    .map((method) => providerName(method.provider))
    .join(" and ");

  const ownedPacks = packs.filter((state) => state.entitled);
  const planCents = subscription?.price?.unitAmount ?? null;
  const packCents = ownedPacks.reduce(
    (sum, state) => sum + (state.priceCents ?? 0),
    0
  );

  return (
    <div className="flex flex-col gap-8">
      <PageHeader
        title="Account"
        description="Who you are to us, and what you pay us with. Nothing here reaches a customer."
      />

      <section id="sign-in" className="flex flex-col gap-4 scroll-mt-20">
        <div>
          <h2 className="font-label text-[11px] uppercase">
            Sign-in
          </h2>
          <p className="text-muted-foreground mt-1 text-sm">
            {methods.length === 1
              ? "One way in. Adding a second is worth doing."
              : `${methods.length} ways in.`}
          </p>
        </div>

        <div className="rounded-xl border p-5">
          <div className="flex flex-col">
            <Method
              name="Email and password"
              detail={session.email}
              state={hasPassword ? "On" : "Not set"}
              on={hasPassword}
            />
            {/* Google is the provider this app actually offers. Listing one it
                does not would be a Connect button that goes nowhere. */}
            <Method
              name="Google"
              detail={
                federated.find((method) => method.provider === "google")
                  ?.identifier ?? "Not connected"
              }
              state={
                federated.some((method) => method.provider === "google")
                  ? "On"
                  : "Off"
              }
              on={federated.some((method) => method.provider === "google")}
            />
          </div>

          <p className="text-muted-foreground mt-4 border-t pt-4 text-xs">
            {/* The reply-to on a document is a different address on purpose:
                one is how we reach the contractor, the other is how their
                customer does. */}
            This is where <strong className="text-foreground">we</strong> reach
            you. What your customer replies to is set in the Office, under
            business identity.
          </p>
        </div>
      </section>

      <section className="flex flex-col gap-4">
        <h2 className="font-label text-[11px] uppercase">
          Password
        </h2>

        <div className="rounded-xl border p-5">
          {hasPassword ? (
            <PasswordForm />
          ) : (
            // A contractor who has only ever tapped "Continue with Google" has
            // no current password to type, so the change form cannot
            // re-authenticate them. Setting a first one is the reset flow, and
            // saying so beats a form that will reject whatever they enter.
            <div className="flex flex-col gap-3">
              <p className="text-sm">
                You sign in with {federatedNames || "a connected account"}, so
                there&apos;s no password on this one yet.
              </p>
              <p className="text-muted-foreground text-sm">
                To add one, sign out and use{" "}
                <span className="text-foreground">Forgot password?</span> on the
                sign-in page. It sets a first password the same way it resets
                one, and your {federatedNames || "connected"} sign-in keeps
                working either way.
              </p>
            </div>
          )}
        </div>
      </section>

      <section id="billing" className="flex flex-col gap-4 scroll-mt-20">
        <div>
          <h2 className="font-label text-[11px] uppercase">
            Billing
          </h2>
          <p className="text-muted-foreground mt-1 text-sm">
            One membership, one card, however many packs.
          </p>
        </div>

        <BillingSummary
          planName={subscription?.product?.name ?? null}
          planCents={planCents}
          packs={ownedPacks}
          totalCents={planCents === null ? null : planCents + packCents}
          nextChargeOn={subscription?.subscription.currentPeriodEnd ?? null}
          card={card}
          receiptCount={receipts.length}
          cancelling={subscription?.subscription.cancelAtPeriodEnd ?? false}
        />

        <p className="text-muted-foreground text-sm">
          What your{" "}
          <strong className="text-foreground font-medium">customers</strong> pay{" "}
          <strong className="text-foreground font-medium">you</strong> with
          isn&apos;t here — that&apos;s a rail, and rails are connections in the
          Office. No destination in this product is named after a vendor.
        </p>
      </section>

      <div className="border-t pt-6">
        <SignOutButton />
      </div>
    </div>
  );
}

function Method({
  name,
  detail,
  state,
  on,
}: {
  name: string;
  detail: string;
  state: string;
  on: boolean;
}) {
  return (
    <div className="flex items-center justify-between gap-4 border-t py-4 first:border-t-0 first:pt-0">
      <div className="min-w-0">
        <p className="text-sm font-medium">{name}</p>
        <p className="text-muted-foreground truncate text-xs">{detail}</p>
      </div>
      <Badge variant={on ? "secondary" : "outline"}>{state}</Badge>
    </div>
  );
}

function providerName(provider: string) {
  return provider.charAt(0).toUpperCase() + provider.slice(1);
}
