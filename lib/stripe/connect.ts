import "server-only";

import type Stripe from "stripe";
import { and, eq } from "drizzle-orm";

import { db } from "@/lib/db";
import { connectedAccounts, connections, organizations } from "@/lib/db/schema";
import type { ConnectedAccount } from "@/lib/db/schema";
import { absoluteUrl } from "@/lib/env";
import { stripe } from "./server";
import { reportError, reportWarning } from "@/lib/observability";

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
 * ## Account configuration — Billing §8.1
 *
 * Accounts are created with **Accounts v2** (`/v2/core/accounts`). Stripe
 * refuses v1 `accounts.create` for new Connect platforms, which is what made
 * "Set up" return a 500. The settings are the same ones, in v2's words:
 *
 * | v1 controller | v2 |
 * |---|---|
 * | `stripe_dashboard.type: 'full'` | `dashboard: 'full'` |
 * | `losses.payments: 'stripe'` | `defaults.responsibilities.losses_collector: 'stripe'` |
 * | `fees.payer: 'account'` | `defaults.responsibilities.fees_collector: 'stripe'` |
 * | `requirement_collection: 'stripe'` | derived by Stripe from the two above |
 *
 * Everything else here still speaks v1. Stripe accepts a v2 account's id on
 * every v1 endpoint and answers in the v1 shape — direct charges with
 * `stripeAccount`, `accounts.retrieve`, login links — and a v2 account still
 * sends v1 `account.updated` to the Connect webhook when its merchant
 * configuration changes. So the projection below reads a v1 `Account`.
 *
 * The trade-off, recorded because these are fixed once set: with Stripe
 * holding losses, Stripe Issuing and Treasury are unavailable to these
 * accounts.
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
 * The organization's connected account, **while it's connected**.
 *
 * Disconnect removes the Office's `connections` row and keeps this one: the
 * Stripe account is still his, an in-flight payment still has to find its shop
 * when its webhook lands, and setting up again should pick up the same account
 * rather than start a second one. So "connected" is the two rows together, and
 * an unlinked account takes no payments and shows no card.
 *
 * `organizationId` must come from the DAL or `requireOrg` — this trusts it,
 * because Drizzle's connection bypasses RLS.
 */
export async function getConnectedAccount(
  organizationId: string
): Promise<ConnectedAccount | null> {
  const [row] = await db
    .select({ account: connectedAccounts })
    .from(connectedAccounts)
    .innerJoin(
      connections,
      and(
        eq(connections.organizationId, connectedAccounts.organizationId),
        eq(connections.provider, "stripe_connect")
      )
    )
    .where(eq(connectedAccounts.organizationId, organizationId))
    .limit(1);

  return row?.account ?? null;
}

/** The account row whether or not it's linked right now. */
async function findAccountRow(
  organizationId: string
): Promise<ConnectedAccount | null> {
  const [row] = await db
    .select()
    .from(connectedAccounts)
    .where(eq(connectedAccounts.organizationId, organizationId))
    .limit(1);

  return row ?? null;
}

/**
 * Which rails the contractor's account can take right now — Billing §8.3:
 * check before offering a way to pay, rather than letting it fail after.
 */
export async function railsFor(
  stripeAccountId: string
): Promise<{ card: boolean; ach: boolean }> {
  const account = await stripe().accounts.retrieve(stripeAccountId);
  return {
    card: account.capabilities?.card_payments === "active",
    ach: account.capabilities?.us_bank_account_ach_payments === "active",
  };
}

/** Whether a pay button may appear at all. */
export function canAcceptPayments(
  account: ConnectedAccount | null
): account is ConnectedAccount {
  return account !== null && account.chargesEnabled;
}

/**
 * Creates the connected account, or returns the one that exists — relinking
 * it to the Office if it was disconnected.
 *
 * Idempotent by the row rather than by a Stripe idempotency key: a second
 * `accounts.create` would produce a second `acct_` that nothing points at and
 * that cannot be deleted once it has processed anything.
 */
export async function getOrCreateConnectedAccount(
  organizationId: string
): Promise<ConnectedAccount> {
  const existing = await findAccountRow(organizationId);
  if (existing) {
    await mirrorToConnections(organizationId, existing, { link: true });
    return existing;
  }

  const [org] = await db
    .select({ name: organizations.name, email: organizations.email })
    .from(organizations)
    .where(eq(organizations.id, organizationId))
    .limit(1);

  const created = await stripe().v2.core.accounts.create({
    // The full Stripe Dashboard. Fixed once set — see the module comment.
    dashboard: "full",
    display_name: org?.name ?? undefined,
    contact_email: org?.email ?? undefined,
    identity: { country: "us" },
    configuration: {
      // The merchant configuration: he is the merchant of record on direct
      // charges. Cards, and ACH debits from a bank account.
      merchant: {
        capabilities: {
          card_payments: { requested: true },
          ach_debit_payments: { requested: true },
        },
      },
    },
    defaults: {
      currency: "usd",
      locales: ["en-US"],
      // Stripe covers unrecoverable negative balances and collects its own
      // processing fees from the contractor, at his rate (§8.1).
      responsibilities: { fees_collector: "stripe", losses_collector: "stripe" },
      profile: {
        doing_business_as: org?.name ?? undefined,
        product_description: "Contracting services",
      },
    },
    metadata: { organizationId },
  });

  // Read back through v1, which every other call here speaks. If Stripe isn't
  // ready to answer for the new account yet, the row starts from what we just
  // created and `account.updated` fills in the rest.
  const account = await stripe()
    .accounts.retrieve(created.id)
    .catch((error: unknown) => {
      reportWarning(
        `[connect] v1 read of new account ${created.id} failed; recording it as onboarding.`,
        error
      );
      return null;
    });

  const values = account
    ? project(organizationId, account)
    : ({
        organizationId,
        stripeAccountId: created.id,
        status: "onboarding",
        businessName: org?.name ?? null,
      } satisfies typeof connectedAccounts.$inferInsert);

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

  await mirrorToConnections(organizationId, row, { link: true });

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
  const link = await stripe().v2.core.accountLinks.create({
    account: account.stripeAccountId,
    use_case: {
      type: "account_onboarding",
      account_onboarding: {
        configurations: ["merchant"],
        // Where Stripe sends him when the link expires before he finishes. It
        // has to mint a *new* link rather than show an error, which is why it
        // points at our start route and not at the form.
        refresh_url: absoluteUrl("/api/stripe/connect/onboard"),
        return_url: absoluteUrl(`${returnPath}?connect=complete`),
        collection_options: {
          // Ask for everything now rather than only what is due today. A
          // contractor sent back to a verification form three weeks later,
          // mid-job, with money pending, is a support ticket.
          fields: "eventually_due",
        },
      },
    },
  });

  return link.url;
}

/**
 * Where a set-up contractor manages his own Stripe account — bank account,
 * payouts, balance, refunds. We do not rebuild any of that.
 *
 * A full-Dashboard account signs in to Stripe directly; only an Express
 * account (created before Billing §8.1) gets a one-time login link.
 */
export async function createDashboardLink(
  account: ConnectedAccount
): Promise<string> {
  if (account.dashboardType === "express") {
    const link = await stripe().accounts.createLoginLink(account.stripeAccountId);
    return link.url;
  }
  return "https://dashboard.stripe.com/";
}

/**
 * Re-reads a shop's account from Stripe while it isn't fully set up.
 *
 * The webhook is the main way state arrives, but a missed or late delivery —
 * or a laptop with no `stripe listen` running — would otherwise leave the
 * Office saying "Setup not finished" after he has finished. One API call, and
 * only for accounts that aren't active yet. A Stripe hiccup leaves the row as
 * it was rather than breaking the page.
 */
export async function refreshConnectedAccount(
  organizationId: string
): Promise<void> {
  const row = await getConnectedAccount(organizationId);
  if (!row || row.status === "active") return;

  try {
    const account = await stripe().accounts.retrieve(row.stripeAccountId);
    await syncConnectedAccount(account);
  } catch (error) {
    reportWarning(
      `[connect] Couldn't refresh ${row.stripeAccountId} from Stripe.`,
      error
    );
  }
}

/**
 * Writes Stripe's account state onto our row.
 *
 * Called from `account.updated` and by `refreshConnectedAccount`. **A projection,
 * never an edit** — every field here is Stripe's answer, and a value we set
 * ourselves would be a value that disagrees with them the first time
 * verification changes.
 *
 * It updates the Office's card only while the account is linked: a Stripe
 * event after a Disconnect must not put the card back.
 */
export async function syncConnectedAccount(
  account: Stripe.Account
): Promise<ConnectedAccount | null> {
  const organizationId =
    account.metadata?.organizationId ?? (await organizationFor(account.id));
  if (!organizationId) {
    // An account we did not create, or one whose metadata was stripped. Better
    // to skip it loudly than to guess which shop it belongs to.
    reportError("[connect] An account has no organizationId in metadata; refusing to project it onto a shop.", undefined, {
      extra: { account: account.id },
    });
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

  await mirrorToConnections(organizationId, row, { link: false });

  return row;
}

/** The shop a Stripe account belongs to, from the row we wrote when we created it. */
async function organizationFor(stripeAccountId: string): Promise<string | null> {
  const [row] = await db
    .select({ organizationId: connectedAccounts.organizationId })
    .from(connectedAccounts)
    .where(eq(connectedAccounts.stripeAccountId, stripeAccountId))
    .limit(1);
  return row?.organizationId ?? null;
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
    // What Stripe says the account actually is, not what we asked for (§8.1).
    dashboardType: account.controller?.stripe_dashboard?.type ?? "full",
    lossesPayments: account.controller?.losses?.payments ?? "stripe",
  } satisfies typeof connectedAccounts.$inferInsert;
}

/**
 * Five words for what Stripe expresses as three booleans and a blob.
 *
 * The order matters: a contractor who *can* charge is active even with
 * paperwork outstanding, because telling him he is not set up while money is
 * arriving is worse than saying nothing.
 *
 * Once the form is submitted and charges are still off, Stripe's
 * `disabled_reason` is set in all three cases that matter, so it can't decide
 * "broken" on its own:
 *
 * - **Stripe said no** (`rejected.*`, `listed`, `platform_paused`) →
 *   `disabled`;
 * - **Stripe wants something from him** — anything currently or past due,
 *   like a full SSN when the last four didn't verify → `restricted`;
 * - **Stripe is still checking** (`requirements.pending_verification`,
 *   `under_review`) → `pending`.
 */
function statusOf(
  account: Stripe.Account
): (typeof connectedAccounts.status.enumValues)[number] {
  if (!account.details_submitted) return "onboarding";

  const requirements = account.requirements;
  const due = [
    ...(requirements?.currently_due ?? []),
    ...(requirements?.past_due ?? []),
  ];

  if (account.charges_enabled) return due.length > 0 ? "restricted" : "active";

  const reason = requirements?.disabled_reason ?? "";
  if (
    reason.startsWith("rejected.") ||
    reason === "listed" ||
    reason === "platform_paused"
  ) {
    return "disabled";
  }
  return due.length > 0 ? "restricted" : "pending";
}

/** One line on the Office's card saying what's in the way, in his words. */
function blockerOf(account: ConnectedAccount): string | null {
  switch (account.status) {
    case "onboarding":
      return null;
    case "restricted":
      return account.chargesEnabled
        ? "Stripe needs a few more details to keep payments on. Finish setting up to see what."
        : "Stripe needs a few more details before you can take payments. Finish setting up to see what.";
    case "pending":
      return "Stripe is checking your details. This usually takes a few minutes.";
    case "disabled":
      return "Stripe has turned off payments on this account. Your Stripe Dashboard says why.";
    case "active":
      return null;
  }
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
  account: ConnectedAccount,
  { link }: { link: boolean }
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
  const lastError = blockerOf(account);

  if (!link) {
    // A status change on an unlinked account changes nothing he can see.
    await db
      .update(connections)
      .set({
        status,
        lastError,
        externalAccountName: account.businessName,
        lastHealthyAt: account.chargesEnabled ? now : null,
        updatedAt: now,
      })
      .where(
        and(
          eq(connections.organizationId, organizationId),
          eq(connections.provider, "stripe_connect")
        )
      );
    return;
  }

  await db
    .insert(connections)
    .values({
      organizationId,
      kind: "processor",
      provider: "stripe_connect",
      status,
      lastError,
      externalAccountId: account.stripeAccountId,
      externalAccountName: account.businessName,
      connectedAt: account.createdAt,
      lastHealthyAt: account.chargesEnabled ? now : null,
    })
    .onConflictDoUpdate({
      target: [connections.organizationId, connections.provider],
      set: {
        status,
        lastError,
        externalAccountId: account.stripeAccountId,
        externalAccountName: account.businessName,
        lastHealthyAt: account.chargesEnabled ? now : null,
        updatedAt: now,
      },
    });
}
