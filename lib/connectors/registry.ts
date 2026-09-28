import "server-only";

import { serverEnv } from "@/lib/env";

/**
 * THE CONNECTOR REGISTRY — one description per provider, read by every surface.
 *
 * ## The rule this whole layer is built around: integrate, don't change
 *
 * A one-truck shop already gets paid somehow and already keeps books somewhere.
 * Requiring a new merchant account to use the product puts a barrier in front
 * of exactly the customer it is for — so nothing here asks a contractor to
 * change how money reaches them. Every provider is one they already have, or
 * can link without changing anything downstream of it.
 *
 * ## What is deliberately absent, and why
 *
 * **Zelle, Venmo, Cash App, cheques and cash are not connectors.** That is a
 * fact about those rails rather than a scoping decision:
 *
 * - **Zelle** has no third-party developer API at all. It is run by the banks,
 *   and integration happens *inside* a financial institution's own digital
 *   banking platform. There is no way for an application like this one to read
 *   or initiate a contractor's Zelle activity.
 * - **Venmo** can be *accepted* as a checkout method, but only through a
 *   PayPal/Braintree merchant account — which is a new account, and therefore
 *   the barrier we are refusing to put up. There is no API over a personal
 *   Venmo balance.
 * - **Cash App** is the same shape: Cash App Pay is a checkout method offered
 *   through Square or Stripe, not a window onto a personal Cash App.
 *
 * A connector for any of them would promise something no code can deliver. So
 * money that arrives those ways reaches the product two honest ways instead,
 * both first-class and neither a connection:
 *
 * 1. **The contractor records it.** Already in the Object Model — "payments
 *    taken outside the platform are first-class; a workflow that only counts
 *    money it processed is a workflow contractors quietly stop using."
 * 2. **The bank feed sees it.** A Zelle transfer, a cashed-out Venmo balance, a
 *    deposited cheque and an ACH all surface as transactions on the business
 *    account, and the product matches them to open invoices — which is exactly
 *    how the contractor's accountant already works.
 *
 * ## What a "processor" slot is for
 *
 * **Optional, always.** A contractor who connects nothing still sends quotes,
 * still gets paid, and still has a complete money record — the pay button is
 * simply absent and the share surface shows his own payment instructions
 * instead. Every payment he takes by cheque, cash or bank transfer is recorded
 * as a first-class ledger entry, equal in every way to one we processed.
 *
 * Two shapes fill the slot, and they are genuinely different:
 *
 * - **Card payments (Stripe).** The platform *creates* the account, inside its
 *   own flow, for a contractor who has no card processing at all. He gives
 *   Stripe his details on Stripe's form and comes back able to charge. This is
 *   the only place the "integrate, don't change" rule bends, and it bends
 *   because the alternative is worse: a one-truck shop with no merchant account
 *   is exactly the customer this is for, and telling him to go get one first is
 *   the barrier we were trying not to put up. He is still the merchant of
 *   record on every charge, his name is on her statement, and the money never
 *   passes through an account this platform controls.
 * - **Square and PayPal.** For a contractor who *already* takes cards and has
 *   no reason to change. Link what he has; nothing downstream of it moves.
 */

export type ConnectorKind = "accounting" | "bank" | "processor" | "mail";

export type ConnectorProvider =
  | "quickbooks"
  | "plaid"
  | "square"
  | "stripe_connect"
  | "paypal"
  | "google_mail";

export type Connector = {
  id: ConnectorProvider;
  kind: ConnectorKind;
  /** What the contractor calls it. */
  name: string;
  /** One line, in their terms, on what connecting it does for them. */
  summary: string;
  /**
   * Exactly what this product reads and writes over there.
   *
   * **Answered before connecting, not after.** "Will it mess up my books?" is
   * the question that decides whether a contractor clicks the button, and their
   * accountant is a real purchase influencer — so the page states the scope in
   * plain language rather than showing a provider's consent screen and hoping.
   */
  reads: string[];
  writes: string[];
  /** Server env vars that must be present before this can be offered. */
  envKeys: string[];
  /**
   * How the contractor attaches it.
   *
   * `hosted` is the odd one out and the reason this is not a boolean: there is
   * no handshake and no credential. The platform creates the account and sends
   * him to the provider's own form, then drives it with its own key. Nothing
   * lands in `connection_secrets`, because there is nothing to keep.
   */
  handshake: "oauth2" | "oauth2_pkce" | "link_token" | "hosted";
  /** Not sellable yet — shown, but not offered. */
  status: "available" | "planned";
};

export const CONNECTORS: Connector[] = [
  {
    id: "quickbooks",
    kind: "accounting",
    name: "QuickBooks",
    summary:
      "Your customers, invoices and payments land in your books without you typing them twice.",
    reads: [
      "Your company name and the accounts on your chart of accounts, so invoices post to the right ones",
      "Whether a customer we send already exists over there, so you don't get duplicates",
    ],
    writes: [
      "Customers you invoice through this app",
      "Invoices, with your numbers and your line items",
      "Payments against those invoices, booked gross with the processing fee as its own expense line",
      "Deposits, as a customer liability that unwinds as you bill — the flow generic syncs get wrong",
    ],
    envKeys: ["QUICKBOOKS_CLIENT_ID", "QUICKBOOKS_CLIENT_SECRET"],
    handshake: "oauth2",
    status: "available",
  },
  {
    id: "plaid",
    kind: "bank",
    name: "Your bank",
    summary:
      "See money arrive without waiting to be told — a cheque, a Zelle transfer, an ACH, all matched to the invoice they pay.",
    reads: [
      "Transactions on the account you pick, so a deposit can be matched to an open invoice",
      "The account name and last four digits, so you can tell which account it is",
    ],
    writes: [
      "Nothing. This connection is read-only — the product cannot move money in or out of your account",
    ],
    envKeys: ["PLAID_CLIENT_ID", "PLAID_SECRET"],
    handshake: "link_token",
    status: "available",
  },
  {
    id: "square",
    kind: "processor",
    name: "Square",
    summary:
      "Already take cards through Square? Your customer gets a pay button, and payments land on the job by themselves.",
    reads: [
      "Payments and refunds on your Square account, so they can be matched to an invoice",
      "Your merchant name and location",
    ],
    writes: [
      "Payment links for the invoices you send, when you ask for one",
    ],
    envKeys: ["SQUARE_APPLICATION_ID", "SQUARE_APPLICATION_SECRET"],
    handshake: "oauth2",
    status: "available",
  },
  {
    id: "stripe_connect",
    kind: "processor",
    name: "Card payments",
    summary:
      "Take cards and bank transfers on your invoices. Set up in a few minutes — the money goes straight to your bank, not through us.",
    reads: [
      "Whether your account can take payments yet, and what's still outstanding if it can't",
      "Charges, refunds, disputes and payouts, so they land on the job by themselves",
    ],
    writes: [
      "Charges you asked for, on the invoices you sent — always in your business's name",
      "Nothing else. We can't move money out of your account, and we never hold it",
    ],
    // The account is created with the platform's own secret key and driven with
    // a `Stripe-Account` header, so there is no extra credential to configure.
    envKeys: ["STRIPE_SECRET_KEY"],
    handshake: "hosted",
    status: "available",
  },
  {
    id: "paypal",
    kind: "processor",
    name: "PayPal",
    summary:
      "Take cards and Venmo through the PayPal business account you already have.",
    reads: ["Payments and refunds on your PayPal business account"],
    writes: ["Payment links for the invoices you send, when you ask for one"],
    envKeys: ["PAYPAL_CLIENT_ID", "PAYPAL_CLIENT_SECRET"],
    handshake: "oauth2",
    status: "planned",
  },
  {
    id: "google_mail",
    kind: "mail",
    name: "Gmail",
    summary:
      "So a customer's reply lands on the job instead of getting lost in your inbox.",
    reads: [
      "Only messages in threads this app started, matched by the reply address on a document you sent",
    ],
    writes: ["Nothing. Quotes and invoices go out on our own sending domain"],
    envKeys: ["GOOGLE_MAIL_CLIENT_ID", "GOOGLE_MAIL_CLIENT_SECRET"],
    handshake: "oauth2",
    status: "planned",
  },
];

export function findConnector(id: string): Connector | undefined {
  return CONNECTORS.find((connector) => connector.id === id);
}

/**
 * Whether this deployment could actually complete the handshake.
 *
 * **A connector with no credentials is shown, not hidden.** A contractor who
 * cannot find QuickBooks concludes the product does not do QuickBooks; one who
 * sees it marked as not ready yet knows it is coming and stops looking. The
 * flag is also what keeps a half-configured staging environment from offering a
 * button that dead-ends on the provider's error page.
 */
export function isConfigured(connector: Connector): boolean {
  const env = serverEnv() as Record<string, string | undefined>;
  return connector.envKeys.every((key) => Boolean(env[key]));
}

/** The slot ordering the Office's connections page renders. */
export const KIND_ORDER: ConnectorKind[] = [
  "accounting",
  "bank",
  "processor",
  "mail",
];

export const KIND_LABELS: Record<
  ConnectorKind,
  { title: string; detail: string }
> = {
  accounting: {
    title: "Your books",
    detail: "So you never type the same invoice twice.",
  },
  bank: {
    title: "Your bank",
    detail:
      "Read-only, and the honest answer for cheques, Zelle and anything else that just shows up.",
  },
  processor: {
    title: "Taking cards",
    detail:
      "Optional. Connect the one you already use, or connect none and take payment the way you always have.",
  },
  mail: {
    title: "Your email",
    detail: "So replies land on the job instead of in your inbox.",
  },
};
