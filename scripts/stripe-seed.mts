/**
 * Seeds a Stripe sandbox with the membership catalog, then mirrors it.
 *
 *     npm run stripe:seed
 *
 * 1. Regenerates `stripe/fixtures/membership.json` from the catalog.
 * 2. Applies it with the Stripe CLI, using `STRIPE_SECRET_KEY` from
 *    `.env.local` — so it seeds the same account the app talks to.
 * 3. Mirrors the result into the database (`stripe:sync`).
 *
 * Refuses a live key. Seeding live is a deliberate, separate act.
 */

import { spawnSync } from "node:child_process";

const key = process.env.STRIPE_SECRET_KEY;
if (!key) {
  console.error("STRIPE_SECRET_KEY is not set in .env.local.");
  process.exit(1);
}
if (!key.startsWith("sk_test_") && !key.startsWith("rk_test_")) {
  console.error("That is not a test-mode key. stripe:seed only seeds sandboxes.");
  process.exit(1);
}

function run(command: string, args: string[]) {
  const result = spawnSync(command, args, { stdio: "inherit", shell: process.platform === "win32" });
  if (result.status !== 0) process.exit(result.status ?? 1);
}

run("npx", ["tsx", "scripts/stripe-fixtures.mts"]);
run("stripe", ["fixtures", "stripe/fixtures/membership.json", "--api-key", key]);
run("npx", [
  "tsx",
  "--env-file=.env.local",
  "--conditions=react-server",
  "scripts/stripe-sync-catalog.mts",
]);
