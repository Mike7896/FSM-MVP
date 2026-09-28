/** Preview: node --experimental-strip-types --env-file=.env.local scripts/seed-gene-receipts.mts
 * Select a job explicitly with --job <job-page-URL-or-UUID>.
 * Add the three demo receipts: append --apply. Safe to run again.
 */
import postgres from "postgres";
import { createHash } from "node:crypto";

const jobArgument = process.argv.indexOf("--job");
const input = jobArgument === -1 ? null : process.argv[jobArgument + 1];
const jobId = input?.match(/(?:\/jobs\/)?([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})(?:[/?#]|$)/i)?.[1] ?? null;
if (jobArgument !== -1 && !jobId) throw new Error("Pass a job page URL or UUID after --job.");

if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required.");
const sql = postgres(process.env.DATABASE_URL, { prepare: false, max: 1, connect_timeout: 10 });

try {
  const matches = jobId ? await sql`
    select j.id, j.organization_id, j.name, j.is_demo, c.name as customer_name
    from jobs j join customers c on c.id = j.customer_id where j.id = ${jobId}
  ` : await sql`
    select j.id, j.organization_id, j.name, j.is_demo
    from jobs j join customers c on c.id = j.customer_id
    where lower(trim(c.name)) = 'gene patterson'
  `;
  console.log("Matching jobs:", matches);
  if (matches.length === 0) {
    const candidates = await sql`
      select j.id, j.name, j.is_demo, c.name as customer_name
      from jobs j join customers c on c.id = j.customer_id
      where c.name ilike '%patterson%' or c.name ilike '%gene%'
    `;
    console.log("Possible name matches (read-only):", candidates);
  }
  if (matches.length !== 1) throw new Error("No unique job selected. Pass --job followed by the job page URL. If that job is not found, this .env.local points to a different database. No receipts were added.");
  const job = matches[0];
  if (!job.is_demo && !jobId) throw new Error("This job is not marked as demo. Select it explicitly with --job if you intend to add sample expenses to it.");
  if (!job.is_demo) console.log("This is not marked as a demo job. Applying these samples adds $356.40 to its recorded spending.");

  const samples = [
    { vendor: "Demo Electrical Supply", amount_cents: 18642, description: "Demo purchase — outlets, wall plates and connectors", purchased_on: "2026-09-18" },
    { vendor: "Demo Hardware Store", amount_cents: 7498, description: "Demo purchase — anchors, fasteners and patching supplies", purchased_on: "2026-09-21" },
    { vendor: "Demo Tool Rental", amount_cents: 9500, description: "Demo purchase — one-day rotary hammer rental", purchased_on: "2026-09-23" },
  ].map((sample, index) => {
    const hash = createHash("sha256").update(`gene-demo-receipt:${job.id}:${index}`).digest("hex");
    const id = `${hash.slice(0, 8)}-${hash.slice(8, 12)}-4${hash.slice(13, 16)}-a${hash.slice(17, 20)}-${hash.slice(20, 32)}`;
    return { id, job_id: job.id, ...sample, category: "Demo materials and equipment" };
  });
  console.log("Demo receipts:", samples);
  if (process.argv.includes("--apply")) {
    await sql.begin(async tx => {
      const eligible = await tx`select id from jobs where id = ${job.id} and organization_id = ${job.organization_id} and is_demo = ${job.is_demo} for update`;
      if (eligible.length !== 1) throw new Error("Demo job eligibility changed; no receipts added.");
      await tx`insert into receipts ${tx(samples)} on conflict (id) do nothing`;
    });
    const saved = await sql`select vendor, amount_cents, purchased_on from receipts where job_id = ${job.id} and id in ${sql(samples.map(row => row.id))}`;
    if (saved.length !== samples.length) throw new Error("Receipt verification failed.");
    console.log("Verified demo receipts:", saved);
  } else {
    console.log("Preview only. Run with --apply to save.");
  }
} finally {
  await sql.end();
}
