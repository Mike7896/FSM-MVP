/** Integration check: temporary users/jobs, no email sends, cleanup in finally. */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { config } from "dotenv";
import { createClient } from "@supabase/supabase-js";
import { createServerClient } from "@supabase/ssr";
import postgres from "postgres";

config({ path: ".env.local", quiet: true });
const base = process.env.FIELD_CHECK_BASE ?? "http://127.0.0.1:3000";
const sql = postgres(process.env.DATABASE_URL, { prepare: false, max: 1 });
const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SECRET_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
const cookieJar = new Map();
const auth = createServerClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, {
  cookies: { getAll: () => [...cookieJar].map(([name, value]) => ({ name, value })), setAll: values => values.forEach(c => cookieJar.set(c.name, c.value)) },
});
const orgIds = [];
const paths = [];
let userId;
let token;
let org;
let passed = 0;
const check = (label, condition) => { assert.ok(condition, label); passed++; console.log(`PASS ${label}`); };
async function api(path, method = "GET", body, authenticated = true, expected = 200) {
  const response = await fetch(`${base}${path}`, { method, headers: {
    "Content-Type": "application/json",
    ...(authenticated ? { Authorization: `Bearer ${token}`, "X-Organization-Id": org.id } : {}),
  }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  const result = await response.json();
  assert.equal(response.status, expected, `${method} ${path}: ${JSON.stringify(result)}`);
  return result.data;
}
const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/lZkAAAAASUVORK5CYII=", "base64");
async function upload(url, authenticated) {
  const slot = await api(url, "POST", { fileName: "test.png" }, authenticated);
  paths.push(slot.path);
  const response = await fetch(slot.signedUrl, { method: "PUT", headers: { "Content-Type": "image/png" }, body: png });
  assert.ok(response.ok, `Upload failed: ${await response.text()}`);
  return slot.path;
}
try {
  const email = `field-check-${randomUUID()}@example.invalid`;
  const password = `Check-${randomUUID()}!`;
  const created = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  if (created.error) throw created.error;
  userId = created.data.user.id;
  const session = await auth.auth.signInWithPassword({ email, password });
  if (session.error) throw session.error;
  token = session.data.session.access_token;
  for (let i = 0; i < 2; i++) {
    const [record] = await sql`insert into organizations (name, slug) values ('Field Workflow Check', ${`field-check-${randomUUID()}`}) returning id`;
    orgIds.push(record.id);
  }
  org = { id: orgIds[0] };
  await sql`insert into memberships (organization_id, user_id, role) values (${org.id}, ${userId}, 'owner')`;
  const jobs = [];
  for (const orgId of orgIds) {
    const [customer] = await sql`insert into customers (organization_id, name) values (${orgId}, 'Temporary Test Customer') returning id`;
    const [job] = await sql`insert into jobs (organization_id, customer_id, name, jurisdiction) values (${orgId}, ${customer.id}, 'Temporary Field Work', 'Test City') returning id, customer_id`;
    jobs.push(job);
  }
  const job = jobs[0];
  const [quote] = await sql`insert into documents (organization_id, job_id, customer_id, type, number, status, title) values (${org.id}, ${job.id}, ${job.customer_id}, 'quote', '', 'draft', 'Temporary quote') returning id`;
  await sql`insert into quote_details (document_id) values (${quote.id})`;
  const [phase] = await sql`insert into draw_schedule (job_id, name, gate, amount_cents) values (${job.id}, 'Rough-in', 'inspection_passed', 10000) returning id`;

  const receiptPath = await upload(`/api/v1/jobs/${job.id}/receipts/upload`, true);
  const receipt = { id: randomUUID(), vendor: 'Test vendor', amountCents: 12345, description: 'Test materials', purchasedOn: '2026-09-15', storagePath: receiptPath };
  await api(`/api/v1/jobs/${job.id}/receipts`, 'POST', receipt);
  await api(`/api/v1/jobs/${job.id}/receipts`, 'POST', receipt);
  const savedReceipts = await api(`/api/v1/jobs/${job.id}/receipts`);
  check('receipt and attachment persist; retry does not double spending', savedReceipts.length === 1 && savedReceipts[0].amountCents === 12345);
  const receiptCookie = [...cookieJar].map(([key, value]) => `${key}=${value}`).join('; ');
  const receiptPage = await fetch(`${base}/jobs/${job.id}/receipt`, { headers: { cookie: receiptCookie } });
  const receiptHtml = await receiptPage.text();
  check('add receipt destination renders the form for a signed-in user', receiptPage.ok && receiptHtml.includes('Attach a photo or PDF') && receiptHtml.includes('Amount paid ($)'));
  const jobPage = await fetch(`${base}/jobs/${job.id}`, { headers: { cookie: receiptCookie } });
  const jobHtml = await jobPage.text();
  check('job dashboard links to the receipt form and renders saved receipt', jobPage.ok && jobHtml.includes(`href="/jobs/${job.id}/receipt"`) && jobHtml.includes('Open receipt from Test vendor'));
  await api(`/api/v1/jobs/${jobs[1].id}/receipts`, 'POST', { ...receipt, id: randomUUID() }, true, 404);
  await api(`/api/v1/jobs/${job.id}/receipts`, 'POST', { ...receipt, id: randomUUID(), storagePath: `${orgIds[1]}/${jobs[1].id}/receipts/test.png` }, true, 422);
  check('receipt writes reject another organization and foreign attachment paths', true);
  const hub = await api(`/api/v1/jobs/${job.id}`);
  check('job money includes the receipt', hub.money.spentCents === 12345);

  const permit = await api('/api/v1/permits', 'POST', { jobId: job.id, jurisdiction: 'Test City', type: 'Electrical', pulledBy: 'subcontractor' }, true, 201);
  await api(`/api/v1/permits/${permit.id}`, 'PATCH', { number: 'TEST-1', status: 'issued', issuedOn: '2026-09-15' });
  const inspection = await api('/api/v1/inspections', 'POST', { permitId: permit.id, type: 'rough_in', scheduledOn: '2026-09-16', clearsPhase: 'Rough-in' }, true, 201);
  await api(`/api/v1/inspections/${inspection.id}`, 'PATCH', { result: 'failed', completedOn: '2026-09-16' }, true, 422);
  await api(`/api/v1/inspections/${inspection.id}`, 'PATCH', { result: 'failed', completedOn: '2026-09-16', correctionsRequired: 'Fix test issue' });
  let current = await api(`/api/v1/jobs/${job.id}`);
  check('failed inspection leaves the phase gated', current.stages.find(s => s.id === phase.id).state === 'gated');
  await api(`/api/v1/inspections/${inspection.id}`, 'PATCH', { result: 'passed', completedOn: '2026-09-16', correctionsRequired: null });
  current = await api(`/api/v1/jobs/${job.id}`);
  check('passing inspection makes its phase billable', current.stages.find(s => s.id === phase.id).state === 'ready');
  const permitRead = await api(`/api/v1/permits/${permit.id}`);
  check('permit number and inspection result survive reload', permitRead.number === 'TEST-1' && permitRead.inspections[0].result === 'passed');
  const [foreignPermit] = await sql`insert into permits (job_id, jurisdiction) values (${jobs[1].id}, 'Other City') returning id`;
  await api('/api/v1/inspections', 'POST', { permitId: foreignPermit.id, type: 'final' }, true, 404);
  check('inspection creation enforces organization ownership', true);

  const question = { id: randomUUID(), prompt: 'Where is the panel?' };
  const info = { id: randomUUID(), questions: [question], photoPrompt: 'Photo of the panel', note: 'Test request' };
  const request = await api(`/api/v1/quotes/${quote.id}/info-requests`, 'POST', info);
  const again = await api(`/api/v1/quotes/${quote.id}/info-requests`, 'POST', info);
  check('information requests reuse the quote link on retry', request.token === again.token);
  await api(`/api/v1/quotes/${quote.id}/info-requests/${info.id}/send`, 'POST', { channel: 'link' });
  let page = await fetch(`${base}/share/${request.token}`);
  check('anonymous customer sees the question on the quote link', page.ok && (await page.text()).includes('Where is the panel?'));
  const replyPath = `/api/share/${request.token}/info-requests/${info.id}`;
  const photo = await upload(`${replyPath}/upload`, false);
  await api(replyPath, 'POST', { answers: [], photoPaths: [photo] }, false, 422);
  await api(replyPath, 'POST', { answers: [{ questionId: question.id, text: 'Garage' }], photoPaths: [receiptPath] }, false, 422);
  await api(replyPath, 'POST', { answers: [{ questionId: question.id, text: 'Garage' }], photoPaths: [photo] }, false);
  await api(replyPath, 'POST', { answers: [{ questionId: question.id, text: 'Garage' }], photoPaths: [photo] }, false);
  const history = await api(`/api/v1/quotes/${quote.id}/info-requests`);
  check('customer reply and photo persist for contractor review', history[0].answers[0].text === 'Garage' && history[0].photos[0].url);
  const captures = await api(`/api/v1/jobs/${job.id}/captures`);
  check('reply photo appears once in job captures after duplicate submit', captures.length === 1);
  const anonymous = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY);
  const exposed = await anonymous.from('info_requests').select('id');
  check('anonymous direct database access cannot read requests', !exposed.data?.length);
  await sql`update share_links set expires_at = now() - interval '1 second' where token = ${request.token}`;
  await api(replyPath, 'POST', { answers: [{ questionId: question.id, text: 'Garage' }], photoPaths: [] }, false, 404);
  check('expired reply tokens are rejected', true);

  const cookie = [...cookieJar].map(([key, value]) => `${key}=${value}`).join('; ');
  for (const [url, content] of [
    [`/jobs/${job.id}/receipt`, 'Attach a photo or PDF'],
    [`/jobs/${job.id}/money`, 'Test vendor'],
    [`/jobs/${job.id}/permits/new`, 'Save permit'],
    [`/jobs/${job.id}/permits/${permit.id}`, 'Record result or edit inspection'],
    [`/quotes/${quote.id}/info-request`, 'Garage'],
  ]) {
    page = await fetch(`${base}${url}`, { headers: { cookie } });
    check(`page renders saved workflow: ${url.split('/').at(-1)}`, page.ok && (await page.text()).includes(content));
  }
  console.log(`\n${passed} integration checks passed. No email was sent.`);
} finally {
  if (paths.length) {
    const removed = await admin.storage.from('job-attachments').remove(paths);
    if (removed.error) console.error('Test upload cleanup failed:', removed.error.message);
  }
  for (const orgId of orgIds) await sql`delete from organizations where id = ${orgId}`;
  if (userId) {
    const removed = await admin.auth.admin.deleteUser(userId);
    if (removed.error) console.error('Test user cleanup failed:', removed.error.message);
  }
  await sql.end();
}
