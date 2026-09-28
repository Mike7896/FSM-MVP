import "server-only";

import type Stripe from "stripe";
import { eq } from "drizzle-orm";

import { db } from "@/lib/db";
import { connectedAccounts, connections, organizations } from "@/lib/db/schema";
import type { ConnectedAccount } from "@/lib/db/schema";
import { absoluteUrl } from "@/lib/env";
import { stripe } from "./server";

/**
 * STRIPE CONNECT — the contractor charging a homeowner.
 *
 * **This is not the Stripe in `sync.ts`.** That one is us charging the
 * contractor for their subscription, on our own account. This one is the
 * contractor charging his customer, on his. Two integrations, one SDK, and
 * conflating them is how a platform ends up holding customer funds.
 *
 * ## Direct charges, and what that decides
 *
 * Every homeowner payment is created **on the connected account**, which
 * settles four things at once:
 *
 * | | Here |
 * |---|---|
 * | Merchant of record | The contractor, always |
 * | Statement descriptor | His business name |
 * | Disputes debit | His Stripe balance, not ours |
 * | Our revenue | An application fee Stripe splits as the money moves |
 *
 * Stripe describes this shape as the one where "your connected accounts
 * transact directly with their customers", and names a SaaS platform enabling
 * invoice payments as the example. The alternative — destination charges —
 * would make *us* the merchant of record, put our name on her statement, and
 * debit disputes from our balance.
 *
 * It is also the compliance seam. Funds settle to the contractor and never
 * touch an account we control. Holding a homeowner's deposit pending our
 * judgment of the work would be money transmission, a state-licensed activity,
 * and no feature in this product is worth acquiring fifty licences for.
 *
 * ## Account configuration
 *
 * `express` dashboard, `losses.payments = 'stripe'`. Stripe carries
 * unrecoverable negative balances and collects KYC; we keep the option to take
 * that liability later, because `stripe_dashboard.type` is the one property
 * Stripe cannot change on an existing account and `full` is incompatible with
 * platform-held losses. Creating accounts the default way would foreclose
 * Issuing and Treasury permanently, for every account, from day one.
 */

/** Stripe's fee splits at the moment money moves — no invoicing, no collection. */
export function applicationFeeCents(
  amountCents: number,
  account: Pick<ConnectedAccount, "applicationFeeBps">
): number {
  if (account.applicationFeeBps <= 0) return 0;
  // Round down. A fee rounded up is a fee that takes a cent the contractor
  // never agreed to, which is a small number and a large conversation.
  return Math.floor((amountCents * account.applicationFeeBps) / 10_000);
}

/**
 * The organization's connected account, if it has one.
 *
 * `organizationId` must come from the DAL or `requireOrg` — this trusts it,
 * because Drizzle's connection bypasses RLS.
 */
export async function getConnectedAccount(
  organizationId: string
): Promise<ConnectedAccount | null> {
  const [row] = await db
    .select()
    .from(connectedAccounts)
    .where(eq(connectedAccounts.organizationId, organizationId))
    .limit(1);

  return row ?? null;
}

/** Whether a pay button may appear at all. */
export function canAcceptPayments(
  account: ConnectedAccount | null
): account is ConnectedAccount {
  return account !== null && account.chargesEnabled;
}

/**
 * Creates the connected account, or returns the one that exists.
 *
 * Idempotent by the row rather than by a Stripe idempotency key: a second
 * `accounts.create` would produce a second `acct_` that nothing points at and
 * that cannot be deleted once it has processed anything.
 */
export async function getOrCreateConnectedAccount(
  organizationId: string
): Promise<ConnectedAccount> {
  const existing = await getConnectedAccount(organizationId);
  if (existing) return existing;

  const [org] = await db
    .select({ name: organizations.name, email: organizations.email })
    .from(organizations)
    .where(eq(organizations.id, organizationId))
    .limit(1);

  const account = await stripe().accounts.create({
    // `controller` rather than the legacy `type: 'express'`. The properties
    // below are what actually decide dashboard access and liability; `type` is
    // a preset over them and says less about what was chosen.
    controller: {
      // Stripe covers unrecoverable negative balances on this account and its
      // risk team manages it. Changing this later is a business decision, and
      // an Express dashboard is what keeps it available to make.
      losses: { payments: "stripe" },
      // Stripe collects KYC and handles verification correspondence.
      requirement_collection: "stripe",
      // Immutable for the life of the account — see the module comment.
      stripe_dashboard: { type: "express" },
      fees: { payer: "account" },
    },
    country: "US",
    email: org?.email ?? undefined,
    business_profile: {
      name: org?.name,
      // What she sees on her statement. The contractor's name, because he is
      // the merchant of record.
      product_description: "Contracting services",
    },
    capabilities: {
      card_payments: { requested: true },
      transfers: { requested: true },
      us_bank_account_ach_payments: { requested: true },
    },
    metadata: { organizationId },
  });

  const values = project(organizationId, account);

  const [row] = await db
    .insert(connectedAccounts)
    .values(values)
    // A race between two tabs both tapping "set up payments" resolves to one
    // row; the loser's `acct_` is orphaned but harmless, having never charged.
    .onConflictDoUpdate({
      target: connectedAccounts.organizationId,
      set: { updatedAt: new Date() },
    })
    .returning();

  await mirrorToConnections(organizationId, row);

  return row;
}

/**
 * A one-time link to Stripe's hosted onboarding form.
 *
 * **Single use and short-lived**, which is why this is a function rather than a
 * column. The contractor gives Stripe his legal name, address, date of birth,
 * SSN and bank details on their page, not ours — we never see those, and that
 * is the point of `requirement_collection: 'stripe'`.
 */
export async function createOnboardingLink(
  account: ConnectedAccount,
  returnPath = "/office/connections"
): Promise<string> {
  const link = await stripe().accountLinks.create({
    account: account.stripeAccountId,
    // Where Stripe sends him when the link expires before he finishes. It has
    // to mint a *new* link rather than show an error, which is why it points at
    // our start route and not at the form.
    refresh_url: absoluteUrl("/api/stripe/connect/onboard"),
    return_url: absoluteUrl(`${returnPath}?connect=complete`),
    type: "account_onboarding",
    collection_options: {
      // Ask for everything now rather than only what is due today. A contractor
      // sent back to a verification form three weeks later, mid-job, with money
      // pending, is a support ticket.
      fields: "eventually_due",
    },
  });

  return link.url;
}

/**
 * A link into the Express dashboard, for a contractor who is already set up.
 *
 * Where he changes his bank account, reads his payout schedule and sees his
 * balance. We do not rebuild any of that.
 */
export async function createDashboardLink(
  account: ConnectedAccount
): Promise<string> {
  const link = await stripe().accounts.createLoginLink(account.stripeAccountId);
  return link.url;
}

/**
 * Writes Stripe's account state onto our row.
 *
 * Called from `account.updated` and after onboarding returns. **A projection,
 * never an edit** — every field here is Stripe's answer, and a value we set
 * ourselves would be a value that disagrees with them the first time
 * verification changes.
 */
export async function syncConnectedAccount(
  account: Stripe.Account
): Promise<ConnectedAccount | null> {
  const organizationId = account.metadata?.organizationId;
  if (!organizationId) {
    // An account we did not create, or one whose metadata was stripped. Better
    // to skip it loudly than to guess which shop it belongs to.
    console.error(
      `[connect] Account ${account.id} has no organizationId in metadata; ` +
        `refusing to project it onto a shop.`
    );
    return null;
  }

  const values = project(organizationId, account);

  const [row] = await db
    .insert(connectedAccounts)
    .values(values)
    .onConflictDoUpdate({
      target: connectedAccounts.organizationId,
      set: {
        status: values.status,
        chargesEnabled: values.chargesEnabled,
        payoutsEnabled: values.payoutsEnabled,
        detailsSubmitted: values.detailsSubmitted,
        requirementsDue: values.requirementsDue,
        disabledReason: values.disabledReason,
        businessName: values.businessName,
        defaultCurrency: values.defaultCurrency,
        onboardedAt: values.onboardedAt,
        updatedAt: new Date(),
      },
    })
    .returning();

  await mirrorToConnections(organizationId, row);

  return row;
}

/* ── Projection ───────────────────────────────────────────────────────── */

function project(organizationId: string, account: Stripe.Account) {
  const requirements = account.requirements;
  const currentlyDue = requirements?.currently_due ?? [];

  return {
    organizationId,
    stripeAccountId: account.id,
    status: statusOf(account),
    chargesEnabled: account.charges_enabled ?? false,
    payoutsEnabled: account.payouts_enabled ?? false,
    detailsSubmitted: account.details_submitted ?? false,
    requirementsDue: currentlyDue,
    disabledReason: requirements?.disabled_reason ?? null,
    businessName: account.business_profile?.name ?? null,
    defaultCurrency: account.default_currency ?? "usd",
    onboardedAt: account.details_submitted ? new Date() : null,
  } satisfies typeof connectedAccounts.$inferInsert;
}

/**
 * Five words for what Stripe expresses as three booleans and a blob.
 *
 * The order matters: a contractor who *can* charge is active even with
 * paperwork outstanding, because telling him he is not set up while money is
 * arriving is worse than saying nothing. `restricted` is the state where he can
 * charge but something is due; `disabled` is where he cannot.
 */
function statusOf(
  account: Stripe.Account
): (typeof connectedAccounts.status.enumValues)[number] {
  if (!account.details_submitted) return "onboarding";

  if (account.charges_enabled) {
    const due = account.requirements?.currently_due ?? [];
    return due.length > 0 ? "restricted" : "active";
  }

  // Submitted, cannot charge. Either Stripe is still looking, or they have
  // said no — and the two need different words on the page.
  return account.requirements?.disabled_reason ? "disabled" : "pending";
}

/**
 * Keeps the Office's processor slot rendering from one query.
 *
 * `connections` is the table the connections page reads, and a Connect account
 * that did not appear there would be a payment processor the Office cannot see.
 * No `connection_secrets` row is written, because there is no credential — we
 * act on this account with our own key.
 */
async function mirrorToConnections(
  organizationId: string,
  account: ConnectedAccount
) {
  // The connection enum separates `needs_reauth` from `degraded` precisely
  // because only one of them has an action attached, and that distinction is
  // what decides whether the Office shows him a button or asks him to wait.
  const status =
    account.status === "active"
      ? ("connected" as const)
      : account.status === "disabled"
        ? ("error" as const)
        : account.status === "pending"
          ? // Stripe is verifying. Nothing for him to do but wait, and a button
            // here would invite him to redo a form that is already submitted.
            ("degraded" as const)
          : // Onboarding or restricted: Stripe wants something from him.
            ("needs_reauth" as const);

  const now = new Date();

  await db
    .insert(connections)
    .values({
      organizationId,
      kind: "processor",
      provider: "stripe_connect",
      status,
      externalAccountId: account.stripeAccountId,
      externalAccountName: account.businessName,
      connectedAt: account.createdAt,
      lastHealthyAt: account.chargesEnabled ? now : null,
    })
    .onConflictDoUpdate({
      target: [connections.organizationId, connections.provider],
      set: {
        status,
        externalAccountId: account.stripeAccountId,
        externalAccountName: account.businessName,
        lastHealthyAt: account.chargesEnabled ? now : null,
        updatedAt: now,
      },
    });
}
