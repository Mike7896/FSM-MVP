import { z } from "zod";

/**
 * Validated environment access.
 *
 * `NEXT_PUBLIC_*` values must be referenced as literal `process.env.X` property
 * accesses so the bundler can inline them into the client bundle - destructuring
 * or dynamic lookup breaks that. Hence the explicit object below.
 */

const clientSchema = z.object({
  NEXT_PUBLIC_SUPABASE_URL: z.url(),
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: z.string().min(1),
  NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY: z.string().min(1).optional(),
  NEXT_PUBLIC_SITE_URL: z.url().default("http://localhost:3000"),
  NEXT_PUBLIC_SENTRY_DSN: z.string().optional(),
});

/**
 * Every connector variable is **optional**, and that is deliberate.
 *
 * A missing QuickBooks client id is a connector this deployment cannot offer,
 * not a broken app. The registry reads these to decide what to show, so local
 * development and preview deploys run with none of them set and every connector
 * marked "not ready yet" rather than the whole server refusing to boot.
 *
 * `CONNECTION_ENCRYPTION_KEY` is the one that bites: it is optional here so the
 * app starts without it, and required at the moment a credential would be
 * stored — because storing plaintext because a variable was missing is worse
 * than refusing to connect.
 */
const serverSchema = z.object({
  DATABASE_URL: z.string().min(1),
  DIRECT_URL: z.string().min(1).optional(),
  SUPABASE_SECRET_KEY: z.string().min(1).optional(),

  // Us charging the contractor. Not the same Stripe as the connector below.
  STRIPE_SECRET_KEY: z.string().min(1).optional(),
  STRIPE_WEBHOOK_SECRET: z.string().min(1).optional(),

  /** 32 bytes, base64. `openssl rand -base64 32`. */
  CONNECTION_ENCRYPTION_KEY: z.string().min(1).optional(),

  // Accounting.
  QUICKBOOKS_CLIENT_ID: z.string().min(1).optional(),
  QUICKBOOKS_CLIENT_SECRET: z.string().min(1).optional(),
  /** "sandbox" until Intuit approves the production app. */
  QUICKBOOKS_ENVIRONMENT: z.enum(["sandbox", "production"]).default("sandbox"),
  /** Intuit signs webhooks with this; it is not the client secret. */
  QUICKBOOKS_WEBHOOK_VERIFIER: z.string().min(1).optional(),

  // Bank feed. Read-only, and the answer for cheques, Zelle and cash deposits.
  PLAID_CLIENT_ID: z.string().min(1).optional(),
  PLAID_SECRET: z.string().min(1).optional(),
  PLAID_ENVIRONMENT: z.enum(["sandbox", "production"]).default("sandbox"),
  PLAID_WEBHOOK_SECRET: z.string().min(1).optional(),

  // Card processors — all optional, all the contractor's own account.
  SQUARE_APPLICATION_ID: z.string().min(1).optional(),
  SQUARE_APPLICATION_SECRET: z.string().min(1).optional(),
  SQUARE_ENVIRONMENT: z.enum(["sandbox", "production"]).default("sandbox"),
  SQUARE_WEBHOOK_SIGNATURE_KEY: z.string().min(1).optional(),

  /**
   * The Connect *client id* (`ca_...`), not the secret key above.
   *
   * Only needed for the OAuth flow that links a contractor's *existing* Stripe
   * account. Accounts this platform creates need no client id — they are made
   * with the platform secret key and driven with a `Stripe-Account` header.
   */
  STRIPE_CONNECT_CLIENT_ID: z.string().min(1).optional(),

  /**
   * Signs the **Connect** event stream, and is a different value from
   * `STRIPE_WEBHOOK_SECRET`.
   *
   * Stripe signs account events and Connect events with separate secrets, so
   * one endpoint cannot verify both. Getting these two crossed produces a
   * signature failure that reads like a code bug.
   */
  STRIPE_CONNECT_WEBHOOK_SECRET: z.string().min(1).optional(),

  PAYPAL_CLIENT_ID: z.string().min(1).optional(),
  PAYPAL_CLIENT_SECRET: z.string().min(1).optional(),

  // Mail.
  GOOGLE_MAIL_CLIENT_ID: z.string().min(1).optional(),
  GOOGLE_MAIL_CLIENT_SECRET: z.string().min(1).optional(),

  /**
   * Shared secret on the queue-drain route.
   *
   * Vercel Cron sends it as a bearer token. Without it the route is an open
   * endpoint that makes this deployment push to every connected provider on
   * demand, which is a denial-of-service against somebody else's books.
   */
  CRON_SECRET: z.string().min(1).optional(),

  /**
   * Email through Resend — quotes, reminders, and a demo sent to yourself.
   *
   * Optional like everything above: with no key, email is simply not offered
   * as a way to send, and copying the link still works.
   */
  RESEND_API_KEY: z.string().min(1).optional(),
  /**
   * The sending address, on a domain verified in Resend. Resend's own
   * `onboarding@resend.dev` works for testing and delivers only to the address
   * the Resend account was opened with. The business's name is put in front
   * of it per email, so this is an address, not a display name.
   */
  EMAIL_FROM: z.string().min(1).default("onboarding@resend.dev"),
  /**
   * Where problem reports, feature ideas and help requests are emailed — the
   * inbox a person at ServiceClerk reads. The sender's address is set as the
   * reply-to, so answering is replying. Optional: without it (or without
   * Resend) every request is still saved, and still reaches Sentry.
   */
  /**
   * Bootstrap owners — comma-separated sign-in addresses. Their admin grants
   * are persisted when they open /admin. Additional admins are stored in
   * platform_admins; removing an address here does not revoke that grant.
   */
  ADMIN_EMAILS: z.string().optional(),
  SUPPORT_EMAIL: z.preprocess((value) => (value === "" ? undefined : value), z.email().optional()),

  /**
   * Texts through Twilio — notifications to the contractor's own phone.
   *
   * Optional like email: with no account set, texts are shown as coming soon
   * and nothing tries to send one. `TWILIO_FROM` is either the sending number
   * (`+15551234567`) or a Messaging Service id (`MG…`); a US number has to be
   * registered for A2P 10DLC before carriers will deliver from it.
   */
  TWILIO_ACCOUNT_SID: z.string().min(1).optional(),
  TWILIO_AUTH_TOKEN: z.string().min(1).optional(),
  TWILIO_FROM: z.string().min(1).optional(),
});

function parse<T extends z.ZodType>(
  schema: T,
  values: Record<string, string | undefined>,
  label: string
) {
  // A blank `KEY=` is a reminder that the value isn't filled in yet, so it reads
  // as unset: optional settings stay off, required ones say they're missing.
  const filled = Object.fromEntries(
    Object.entries(values).map(([key, value]) => [key, value === "" ? undefined : value])
  );
  const result = schema.safeParse(filled);
  if (!result.success) {
    const issues = result.error.issues
      .map((i) => `  - ${i.path.join(".") || "(root)"}: ${i.message}`)
      .join("\n");
    throw new Error(
      `Invalid ${label} environment variables:\n${issues}\n\n` +
        `Copy .env.example to .env.local and fill in the missing values.`
    );
  }
  return result.data as z.infer<T>;
}

export const clientEnv = parse(
  clientSchema,
  {
    NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
    NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY:
      process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY,
    NEXT_PUBLIC_SITE_URL: process.env.NEXT_PUBLIC_SITE_URL,
    NEXT_PUBLIC_SENTRY_DSN: process.env.NEXT_PUBLIC_SENTRY_DSN,
  },
  "client"
);

/**
 * Server-only. Throws if imported into a Client Component bundle.
 */
export function serverEnv() {
  if (typeof window !== "undefined") {
    throw new Error("serverEnv() must not be called in the browser.");
  }
  return parse(serverSchema, process.env, "server");
}

/** Absolute URL helper for redirects, Stripe return URLs and auth callbacks. */
export function absoluteUrl(path = "/") {
  const base = clientEnv.NEXT_PUBLIC_SITE_URL.replace(/\/$/, "");
  return `${base}${path.startsWith("/") ? path : `/${path}`}`;
}
