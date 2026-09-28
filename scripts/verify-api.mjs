/**
 * Exercises the v1 API the way a native client would: a Supabase access token
 * in an Authorization header, no cookies anywhere.
 *
 * Creates a dedicated test user rather than touching the real account. Safe to
 * re-run — it reuses the user and organization if they already exist.
 */
import { config } from "dotenv";
import { createClient } from "@supabase/supabase-js";

config({ path: ".env.local" });

const BASE = "http://localhost:3000";
const EMAIL = "api-test@fsm.local";
const PASSWORD = "fsm-api-test-password-1";

const admin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SECRET_KEY,
  { auth: { persistSession: false, autoRefreshToken: false } }
);

const pass = [];
const failures = [];

function check(label, condition, detail) {
  if (condition) {
    pass.push(label);
    console.log(`  PASS  ${label}`);
  } else {
    failures.push(`${label} — ${detail ?? ""}`);
    console.log(`  FAIL  ${label} ${detail ? `— ${detail}` : ""}`);
  }
}

async function api(path, { token, method = "GET", body, headers } = {}) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(body ? { "Content-Type": "application/json" } : {}),
      ...headers,
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  let json = null;
  try {
    json = await res.json();
  } catch {
    /* 204 and friends */
  }
  return { status: res.status, json };
}

// ── Test user ────────────────────────────────────────────────────────────
let userId;
{
  const { data, error } = await admin.auth.admin.createUser({
    email: EMAIL,
    password: PASSWORD,
    email_confirm: true,
  });
  if (error && !/already/i.test(error.message)) throw error;
  if (data?.user) userId = data.user.id;
  if (!userId) {
    const { data: list } = await admin.auth.admin.listUsers();
    userId = list.users.find((u) => u.email === EMAIL)?.id;
  }
  console.log(`test user: ${EMAIL}`);
}

// ── Sign in the way a mobile client would ────────────────────────────────
const anon = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
  { auth: { persistSession: false } }
);
const { data: session, error: signInError } =
  await anon.auth.signInWithPassword({ email: EMAIL, password: PASSWORD });
if (signInError) throw signInError;
const token = session.session.access_token;
console.log(`access token acquired (${token.length} chars)\n`);

console.log("AUTH");
{
  const anonRes = await api("/api/v1/jobs");
  check("no credentials -> 401", anonRes.status === 401, `got ${anonRes.status}`);
  check(
    "401 uses the error envelope",
    anonRes.json?.error?.code === "unauthenticated",
    JSON.stringify(anonRes.json)
  );

  const bad = await api("/api/v1/jobs", { token: "not-a-real-token" });
  check("bogus bearer -> 401", bad.status === 401, `got ${bad.status}`);
}

console.log("\nORGANIZATION");
let organizationId;
{
  const before = await api("/api/v1/organizations", { token });
  check("GET organizations -> 200", before.status === 200, `got ${before.status}`);

  if (before.json.data.length > 0) {
    organizationId = before.json.data[0].id;
    console.log(`  (reusing organization ${organizationId})`);
  } else {
    const res = await api("/api/v1/organizations", {
      token,
      method: "POST",
      body: { name: "Whitfield Electric", phone: "(512) 555-0100" },
    });
    check("POST organizations -> 201", res.status === 201, JSON.stringify(res.json));
    check("slug generated", res.json?.data?.slug === "whitfield-electric", res.json?.data?.slug);
    organizationId = res.json?.data?.id;
  }

  const noOrgYet = await api("/api/v1/jobs", { token, headers: { "X-Organization-Id": "00000000-0000-0000-0000-000000000000" } });
  check("foreign X-Organization-Id -> 403", noOrgYet.status === 403, `got ${noOrgYet.status}`);
}

console.log("\nVALIDATION");
{
  const res = await api("/api/v1/customers", {
    token,
    method: "POST",
    body: { email: "not-an-email" },
  });
  check("missing/invalid fields -> 422", res.status === 422, `got ${res.status}`);
  check(
    "422 names the fields",
    Array.isArray(res.json?.error?.details) &&
      res.json.error.details.some((d) => d.field === "name"),
    JSON.stringify(res.json?.error?.details)
  );
}

console.log("\nCUSTOMER");
let customerId;
{
  const res = await api("/api/v1/customers", {
    token,
    method: "POST",
    body: {
      name: "Dana Whitfield",
      email: "dana@example.com",
      phone: "(512) 555-0199",
      address: "418 Cedar St, Austin TX",
    },
  });
  check("POST customers -> 201", res.status === 201, JSON.stringify(res.json));
  customerId = res.json?.data?.id;

  const list = await api("/api/v1/customers?q=Dana", { token });
  check("GET customers?q= finds it", list.json?.data?.length >= 1, JSON.stringify(list.json));
}

console.log("\nJOB");
let jobId;
{
  const orphan = await api("/api/v1/jobs", {
    token,
    method: "POST",
    body: { customerId: "00000000-0000-0000-0000-000000000000" },
  });
  check("job against a foreign customer -> 404", orphan.status === 404, `got ${orphan.status}`);

  const res = await api("/api/v1/jobs", {
    token,
    method: "POST",
    body: {
      customerId,
      name: "200A service upgrade",
      address: "418 Cedar St, Austin TX",
    },
  });
  check("POST jobs -> 201", res.status === 201, JSON.stringify(res.json));
  jobId = res.json?.data?.id;
  check("number assigned by trigger", res.json?.data?.number >= 1, `number=${res.json?.data?.number}`);
  check(
    "jurisdiction derived from address",
    !!res.json?.data?.jurisdiction,
    `jurisdiction=${res.json?.data?.jurisdiction}`
  );

  const second = await api("/api/v1/jobs", {
    token,
    method: "POST",
    body: { customerId, name: "Kitchen circuits" },
  });
  check(
    "second job increments the number",
    second.json?.data?.number === res.json?.data?.number + 1,
    `${res.json?.data?.number} -> ${second.json?.data?.number}`
  );

  // A job can name its customer instead of pointing at one — New job's "add
  // them by name". An exact name, any case, reuses the existing row.
  const byName = await api("/api/v1/jobs", {
    token,
    method: "POST",
    body: { customerName: "Rosa Delgado", name: "Garage subpanel" },
  });
  check("POST jobs with a typed name -> 201", byName.status === 201, JSON.stringify(byName.json));
  const rosas = await api("/api/v1/customers?q=Rosa%20Delgado", { token });
  check(
    "typed name made one customer, and re-runs reuse it",
    rosas.json?.data?.length === 1 &&
      rosas.json.data[0].id === byName.json?.data?.customerId,
    JSON.stringify(rosas.json?.data)
  );

  // The CUSTOMER step adds a Dana on every run, so "reused" means one of the
  // Danas already there, and no new one.
  const danas = async () =>
    (await api("/api/v1/customers?q=Dana%20Whitfield&limit=100", { token }))
      .json?.data ?? [];
  const danasBefore = await danas();
  const matched = await api("/api/v1/jobs", {
    token,
    method: "POST",
    body: { customerName: "dana WHITFIELD", name: "Porch light" },
  });
  const danasAfter = await danas();
  check(
    "typed name matching an existing customer reuses them",
    matched.status === 201 &&
      danasAfter.length === danasBefore.length &&
      danasBefore.some((d) => d.id === matched.json?.data?.customerId),
    `${danasBefore.length} -> ${danasAfter.length}, got ${matched.json?.data?.customerId}`
  );

  const nobody = await api("/api/v1/jobs", {
    token,
    method: "POST",
    body: { name: "No one's job" },
  });
  check(
    "job with no customer at all -> 422 naming customerName",
    nobody.status === 422 &&
      nobody.json?.error?.details?.some((d) => d.field === "customerName"),
    `${nobody.status} ${JSON.stringify(nobody.json?.error?.details)}`
  );

  const one = await api(`/api/v1/jobs/${jobId}`, { token });
  check("GET jobs/[id] -> 200", one.status === 200, `got ${one.status}`);
  check(
    "money state present on the payload",
    one.status === 200 && one.json?.data?.money != null,
    JSON.stringify(one.json)
  );
  check(
    "money starts at zero",
    one.json?.data?.money?.totalCents === 0 &&
      one.json?.data?.money?.collectedCents === 0,
    JSON.stringify(one.json?.data?.money)
  );

  const patched = await api(`/api/v1/jobs/${jobId}`, {
    token,
    method: "PATCH",
    body: { status: "scheduled" },
  });
  check("PATCH jobs/[id] -> 200", patched.status === 200, `got ${patched.status}`);
  check("status changed", patched.json?.data?.status === "scheduled", patched.json?.data?.status);

  const missing = await api(`/api/v1/jobs/00000000-0000-0000-0000-000000000000`, { token });
  check("unknown job -> 404", missing.status === 404, `got ${missing.status}`);

  const empty = await api(`/api/v1/jobs/${jobId}`, { token, method: "PATCH", body: {} });
  check("empty PATCH -> 422", empty.status === 422, `got ${empty.status}`);
}

console.log("\nTENANT ISOLATION");
{
  // Two separate cases, and they need two separate users.
  //
  // `noshop` exists purely to assert the no-membership refusal, and nothing in
  // the suite ever creates a shop for it. It used to share a user with the
  // cross-tenant check below, which silently broke the moment that user was
  // given a shop by an unrelated test.
  const noShopEmail = "api-test-noshop@fsm.local";
  const otherEmail = "api-test-2@fsm.local";

  for (const email of [noShopEmail, otherEmail]) {
    const { error: e } = await admin.auth.admin.createUser({
      email,
      password: PASSWORD,
      email_confirm: true,
    });
    if (e && !/already/i.test(e.message)) throw e;
  }
  const { data: noShopSession } = await anon.auth.signInWithPassword({
    email: noShopEmail,
    password: PASSWORD,
  });
  const noShop = await api("/api/v1/jobs", {
    token: noShopSession.session.access_token,
  });
  check("user with no shop -> 403", noShop.status === 403, `got ${noShop.status}`);

  const { data: other } = await anon.auth.signInWithPassword({
    email: otherEmail,
    password: PASSWORD,
  });
  const stolen = await api(`/api/v1/jobs/${jobId}`, {
    token: other.session.access_token,
    headers: { "X-Organization-Id": organizationId },
  });
  check(
    "other user asking for our shop -> 403",
    stolen.status === 403,
    `got ${stolen.status}`
  );
}


// ── The Office: identity, defaults, branding, licenses, packs ────────────
console.log("\nOFFICE IDENTITY");
{
  const before = await api("/api/v1/office", { token });
  check("GET office -> 200", before.status === 200, `got ${before.status}`);

  const saved = await api("/api/v1/office", {
    token,
    method: "PATCH",
    body: {
      name: "Whitfield Electric",
      phone: "(512) 555-0148",
      email: "",
      address: "118 Mill Rd, Ardmore, PA 19003",
      website: "",
      logoUrl: "",
    },
  });
  check("PATCH office -> 200", saved.status === 200, JSON.stringify(saved.json));
  // An empty string is *absent*, not stored — the projection draws a visible
  // gap for a missing value and an empty line for an empty string.
  check("blank email stored as null", saved.json?.data?.email === null, JSON.stringify(saved.json?.data));

  const nameless = await api("/api/v1/office", {
    token,
    method: "PATCH",
    body: {
      name: "",
      phone: null,
      email: null,
      address: null,
      website: null,
      logoUrl: null,
    },
  });
  check("empty business name -> 422", nameless.status === 422, `got ${nameless.status}`);
}

console.log("\nOFFICE DEFAULTS");
{
  const empty = await api("/api/v1/office/defaults", { token });
  check("GET defaults -> 200", empty.status === 200, `got ${empty.status}`);

  const saved = await api("/api/v1/office/defaults", {
    token,
    method: "PATCH",
    body: {
      depositPercent: 30,
      materialMarkupPercent: 32,
      laborRateCents: 11400,
      taxRate: 0.0825,
      quoteValidityDays: 30,
      drawPattern: [
        { name: "Deposit", percent: 30 },
        { name: "Rough-in passed", percent: 40 },
        { name: "Final", percent: 30 },
      ],
      standardExclusions: "Drywall repair and paint after access",
      standardAssumptions: "Power can be shut off during work",
      standardTerms: "Workmanship warranted for 12 months from completion.",
      documentPreset: "with_logo",
    },
  });
  check("PATCH defaults -> 200", saved.status === 200, JSON.stringify(saved.json));
  check(
    "draw pattern stored in order",
    saved.json?.data?.drawPattern?.[1]?.name === "Rough-in passed",
    JSON.stringify(saved.json?.data?.drawPattern)
  );
  // The fraction a Quote stores, not the percentage the form showed.
  check("tax stored as a fraction", Number(saved.json?.data?.taxRate) === 0.0825, saved.json?.data?.taxRate);
  check("labor stored as cents", saved.json?.data?.laborRateCents === 11400, saved.json?.data?.laborRateCents);

  const cleared = await api("/api/v1/office/defaults", {
    token,
    method: "PATCH",
    body: {
      depositPercent: null, materialMarkupPercent: null, laborRateCents: null,
      taxRate: null, quoteValidityDays: null, drawPattern: null,
      standardExclusions: null, standardAssumptions: null, standardTerms: null,
      documentPreset: null,
    },
  });
  // A business that has not set a tax rate is not one with a 0% rate.
  check("cleared field stores null, not zero", cleared.json?.data?.taxRate === null, JSON.stringify(cleared.json?.data));

  const bogus = await api("/api/v1/office/defaults", {
    token, method: "PATCH",
    body: { depositPercent: 30, materialMarkupPercent: null, laborRateCents: null,
            taxRate: 4, quoteValidityDays: null, drawPattern: null,
            standardExclusions: null, standardAssumptions: null,
            standardTerms: null, documentPreset: null },
  });
  check("a 400% tax rate -> 422", bogus.status === 422, `got ${bogus.status}`);

  // A draw pattern that does not add up is a job that cannot be fully billed,
  // and finding that out on the last draw is the expensive moment.
  const lopsided = await api("/api/v1/office/defaults", {
    token, method: "PATCH",
    body: { depositPercent: null, materialMarkupPercent: null, laborRateCents: null,
            taxRate: null, quoteValidityDays: null,
            drawPattern: [{ name: "Deposit", percent: 30 }],
            standardExclusions: null, standardAssumptions: null,
            standardTerms: null, documentPreset: null },
  });
  check("a draw pattern summing to 30% -> 422", lopsided.status === 422, `got ${lopsided.status}`);
}

console.log("\nDOCUMENT BRANDING");
{
  const saved = await api("/api/v1/office/branding", {
    token, method: "PATCH", body: { documentPreset: "bold_header" },
  });
  check("PATCH branding -> 200", saved.status === 200, JSON.stringify(saved.json));
  check("preset stored", saved.json?.data?.documentPreset === "bold_header", JSON.stringify(saved.json?.data));

  const bogus = await api("/api/v1/office/branding", {
    token, method: "PATCH", body: { documentPreset: "neon" },
  });
  check("an unknown preset -> 422", bogus.status === 422, `got ${bogus.status}`);
}

console.log("\nLICENSES");
{
  const created = await api("/api/v1/licenses", {
    token, method: "POST",
    body: { jurisdiction: "Lower Merion Township", number: "LM-8841", class: "Master", holder: "Mark Whitfield", expiresOn: "2027-03-01" },
  });
  check("POST license -> 201", created.status === 201, JSON.stringify(created.json));
  const licenseId = created.json?.data?.id;

  const dupe = await api("/api/v1/licenses", {
    token, method: "POST",
    body: { jurisdiction: "Lower Merion Township", number: "LM-8841", class: null, holder: null },
  });
  check("same number in same jurisdiction -> 409", dupe.status === 409, `got ${dupe.status}`);

  const listed = await api("/api/v1/licenses", { token });
  check("GET licenses -> 200", listed.status === 200, `got ${listed.status}`);
  check("the license is listed", listed.json?.data?.some((l) => l.id === licenseId), JSON.stringify(listed.json?.data?.length));

  const patched = await api(`/api/v1/licenses/${licenseId}`, {
    token, method: "PATCH", body: { number: "LM-8842" },
  });
  check("PATCH license -> 200", patched.status === 200, JSON.stringify(patched.json));
  check("the correction stuck", patched.json?.data?.number === "LM-8842", patched.json?.data?.number);

  const missing = await api("/api/v1/licenses/00000000-0000-0000-0000-000000000000", {
    token, method: "PATCH", body: { number: "X" },
  });
  check("unknown license -> 404", missing.status === 404, `got ${missing.status}`);

  const removed = await api(`/api/v1/licenses/${licenseId}`, { token, method: "DELETE" });
  check("DELETE license -> 204", removed.status === 204, `got ${removed.status}`);
}

console.log("\nTRADE PACKS");
{
  const listed = await api("/api/v1/packs", { token });
  check("GET packs -> 200", listed.status === 200, `got ${listed.status}`);
  check("the catalogue is there", (listed.json?.data?.length ?? 0) >= 1, String(listed.json?.data?.length));
  check("nothing is entitled by default", listed.json?.data?.every((p) => p.entitled === false), JSON.stringify(listed.json?.data));

  // Enabling a pack nobody paid for would be handing out a paid feature on the
  // client's say-so. Entitlements are written by the webhook that saw the money.
  const sneaky = await api("/api/v1/packs/electrical", {
    token, method: "PATCH", body: { enabled: true },
  });
  check("enabling an unowned pack -> 403", sneaky.status === 403, `got ${sneaky.status}`);

  // Switching one off is always allowed — off is not the same as gone.
  const off = await api("/api/v1/packs/electrical", {
    token, method: "PATCH", body: { enabled: false },
  });
  check("disabling is always allowed -> 200", off.status === 200, JSON.stringify(off.json));

  const nonsense = await api("/api/v1/packs/underwater-basket-weaving", {
    token, method: "PATCH", body: { enabled: false },
  });
  check("unknown pack -> 404", nonsense.status === 404, `got ${nonsense.status}`);
}


// ── Captures: the walkthrough, and what a customer sent in ───────────────
console.log("\nCAPTURES");
{
  // A note needs no file, so it exercises the whole path without Storage.
  const note = await api(`/api/v1/jobs/${jobId}/captures`, {
    token, method: "POST",
    body: { kind: "note", body: "She wants the dryer circuit while we're in there" },
  });
  check("POST capture (note) -> 201", note.status === 201, JSON.stringify(note.json));
  const captureId = note.json?.data?.id;

  const listed = await api(`/api/v1/jobs/${jobId}/captures`, { token });
  check("GET captures -> 200", listed.status === 200, `got ${listed.status}`);
  check("the note is on the job", listed.json?.data?.some((c) => c.id === captureId), String(listed.json?.data?.length));

  // A photo with no file behind it is a thumbnail that never loads.
  const orphan = await api(`/api/v1/jobs/${jobId}/captures`, {
    token, method: "POST", body: { kind: "photo" },
  });
  check("photo with no file -> 422", orphan.status === 422, `got ${orphan.status}`);

  const empty = await api(`/api/v1/jobs/${jobId}/captures`, {
    token, method: "POST", body: { kind: "note", body: "" },
  });
  check("empty note -> 422", empty.status === 422, `got ${empty.status}`);

  // A capture has no organization of its own — the Job is the check.
  const foreign = await api("/api/v1/jobs/00000000-0000-0000-0000-000000000000/captures", {
    token, method: "POST", body: { kind: "note", body: "not mine" },
  });
  check("capture on a foreign job -> 404", foreign.status === 404, `got ${foreign.status}`);

  const removed = await api(`/api/v1/captures/${captureId}`, { token, method: "DELETE" });
  check("DELETE capture -> 204", removed.status === 204, `got ${removed.status}`);

  const gone = await api(`/api/v1/captures/${captureId}`, { token, method: "DELETE" });
  check("deleting it twice -> 404", gone.status === 404, `got ${gone.status}`);
}

console.log("\nSEARCH");
{
  const anon = await api("/api/v1/search?q=Dana");
  check("search without a token -> 401", anon.status === 401, `got ${anon.status}`);

  const all = await api("/api/v1/search?q=Dana", { token });
  check("GET search -> 200", all.status === 200, JSON.stringify(all.json));
  const groups = all.json?.data?.groups ?? [];
  check(
    "every group comes back, named",
    groups.map((g) => g.kind).join(",") ===
      "customers,jobs,quotes,contracts,change-orders,invoices",
    JSON.stringify(groups.map((g) => g.kind))
  );
  const customers = groups.find((g) => g.kind === "customers");
  check(
    "the customer is in it, with somewhere to go",
    customers?.hits?.some(
      (hit) => /Dana/i.test(hit.title) && hit.href.startsWith("/customers/")
    ),
    JSON.stringify(customers?.hits?.slice(0, 2))
  );
  check(
    "jobs match on their customer's name too",
    groups.find((g) => g.kind === "jobs")?.hits?.length > 0,
    JSON.stringify(groups.find((g) => g.kind === "jobs")?.hits?.slice(0, 1))
  );

  // Paging is per group, and the pages must not overlap — the failure this
  // catches is rows sharing a timestamp being handed to two pages at once.
  const first = await api("/api/v1/search?q=Dana&kind=jobs&limit=3&offset=0", { token });
  const second = await api("/api/v1/search?q=Dana&kind=jobs&limit=3&offset=3", { token });
  const firstIds = (first.json?.data?.groups?.[0]?.hits ?? []).map((h) => h.id);
  const secondIds = (second.json?.data?.groups?.[0]?.hits ?? []).map((h) => h.id);
  check("a group pages on its own", firstIds.length === 3, JSON.stringify(firstIds));
  check(
    "the second page is new rows, not the first page again",
    secondIds.length > 0 && secondIds.every((id) => !firstIds.includes(id)),
    JSON.stringify({ firstIds, secondIds })
  );
  check(
    "it says when there's more",
    first.json?.data?.groups?.[0]?.hasMore === true,
    JSON.stringify(first.json?.data?.groups?.[0]?.hasMore)
  );

  const nothing = await api("/api/v1/search?q=zzzznothingmatchesthis", { token });
  check(
    "a search that matches nothing -> empty groups, not an error",
    nothing.status === 200 &&
      (nothing.json?.data?.groups ?? []).every((g) => g.hits.length === 0),
    JSON.stringify(nothing.json?.data?.groups?.map((g) => g.hits.length))
  );

  const bogus = await api("/api/v1/search?q=Dana&kind=unicorns", { token });
  check("an unknown kind -> 422", bogus.status === 422, `got ${bogus.status}`);

  const blank = await api("/api/v1/search?q=", { token });
  check("no search term -> 422", blank.status === 422, `got ${blank.status}`);
}

console.log("\nIMPORT");
{
  const csv =
    "Client Name,E-Mail,Cell Phone\r\n" +
    "Imported Person,imported@example.test,512-555-0100\r\n" +
    "Dana Whitfield,dana@example.com,\r\n" +
    "Nora Vance,not-an-email,\r\n" +
    // A spreadsheet's trailing empty row is not an error, and is dropped.
    ",,\r\n";

  const anon = await api("/api/v1/import/customers/preview", {
    method: "POST",
    body: { csv },
  });
  check("preview without a token -> 401", anon.status === 401, `got ${anon.status}`);

  const preview = await api("/api/v1/import/customers/preview", {
    token,
    method: "POST",
    body: { csv },
  });
  check("POST preview -> 200", preview.status === 200, JSON.stringify(preview.json));
  const data = preview.json?.data;
  check(
    "it reads their headings",
    data?.columns?.map((c) => c.field).join(",") === "name,email,phone",
    JSON.stringify(data?.columns)
  );
  check(
    "it judges each row",
    data?.counts?.new === 1 &&
      data?.counts?.duplicate === 1 &&
      data?.counts?.invalid === 1,
    JSON.stringify(data?.counts)
  );

  const empty = await api("/api/v1/import/customers", {
    token,
    method: "POST",
    body: { rows: [] },
  });
  check("importing nothing -> 422", empty.status === 422, `got ${empty.status}`);

  const nameless = await api("/api/v1/import/customers", {
    token,
    method: "POST",
    body: { rows: [{ name: "" }] },
  });
  check("a row with no name -> 422", nameless.status === 422, `got ${nameless.status}`);

  const marker = `Imported ${Date.now()}`;
  const done = await api("/api/v1/import/customers", {
    token,
    method: "POST",
    body: { rows: [{ name: marker, email: "imported@example.test" }] },
  });
  check("POST import -> 201", done.status === 201, JSON.stringify(done.json));
  check("it says how many landed", done.json?.data?.created === 1, JSON.stringify(done.json));

  const found = await api(`/api/v1/customers?q=${encodeURIComponent(marker)}`, { token });
  check(
    "the imported customer is in the directory",
    found.json?.data?.[0]?.email === "imported@example.test",
    JSON.stringify(found.json?.data)
  );

  const again = await api("/api/v1/import/customers/preview", {
    token,
    method: "POST",
    body: { csv: `name\r\n${marker}\r\n` },
  });
  check(
    "importing the same person again is flagged",
    again.json?.data?.counts?.duplicate === 1,
    JSON.stringify(again.json?.data?.counts)
  );
}

console.log("\nEXPORT");
{
  // A file, not the { data } envelope — so these read the response directly.
  async function raw(path, bearer) {
    const res = await fetch(`${BASE}${path}`, {
      headers: bearer ? { Authorization: `Bearer ${bearer}` } : {},
    });
    // Bytes as well as text: decoding to a string swallows the byte-order
    // mark, and the mark is the whole reason Excel reads the file correctly.
    const bytes = new Uint8Array(await res.arrayBuffer());
    return {
      status: res.status,
      headers: res.headers,
      bytes,
      body: new TextDecoder().decode(bytes),
    };
  }

  const anon = await raw("/api/v1/export?table=jobs");
  check("export without a token -> 401", anon.status === 401, `got ${anon.status}`);

  const jobsCsv = await raw("/api/v1/export?table=jobs", token);
  check("GET export?table=jobs -> 200", jobsCsv.status === 200, `got ${jobsCsv.status}`);
  check(
    "it comes back as a CSV download",
    jobsCsv.headers.get("content-type")?.includes("text/csv") &&
      jobsCsv.headers.get("content-disposition")?.includes("attachment"),
    `${jobsCsv.headers.get("content-type")} | ${jobsCsv.headers.get("content-disposition")}`
  );
  check(
    "headings are words, not column names",
    jobsCsv.body.replace(/^﻿/, "").startsWith('"Job number","Customer","Work"'),
    JSON.stringify(jobsCsv.body.slice(0, 80))
  );
  check(
    "the file opens correctly in Excel (BOM, CRLF)",
    jobsCsv.bytes[0] === 0xef &&
      jobsCsv.bytes[1] === 0xbb &&
      jobsCsv.bytes[2] === 0xbf &&
      jobsCsv.body.includes("\r\n"),
    `${[...jobsCsv.bytes.slice(0, 3)].map((b) => b.toString(16)).join(" ")}`
  );
  check(
    "the jobs this run created are in it",
    jobsCsv.body.includes("200A service upgrade") &&
      jobsCsv.body.includes("Rosa Delgado"),
    JSON.stringify(jobsCsv.body.slice(0, 300))
  );

  const nonsense = await raw("/api/v1/export?table=unicorns", token);
  check("an unknown set -> 422", nonsense.status === 422, `got ${nonsense.status}`);

  const everything = await raw("/api/v1/export", token);
  check("GET export -> 200", everything.status === 200, `got ${everything.status}`);
  check(
    "it comes back as a JSON download",
    everything.headers.get("content-disposition")?.includes("everything-"),
    String(everything.headers.get("content-disposition"))
  );

  let parsed = null;
  try {
    parsed = JSON.parse(everything.body);
  } catch {
    /* the next check reports it */
  }
  check("the one file parses", parsed !== null);
  check(
    "every set is in it",
    parsed !== null &&
      [
        "customers", "jobs", "quotes", "contracts", "change-orders",
        "invoices", "payments", "receipts", "permits",
      ].every((key) => Array.isArray(parsed[key])),
    parsed ? Object.keys(parsed).join(", ") : "unparsed"
  );
  check(
    "with this shop's jobs in it",
    parsed?.jobs?.some((row) => row["Work"] === "200A service upgrade"),
    JSON.stringify(parsed?.jobs?.slice(0, 2))
  );
  check(
    "money leaves as dollars",
    (parsed?.invoices ?? []).every(
      (row) => row.Amount === null || /^-?\d+\.\d{2}$/.test(row.Amount)
    ),
    JSON.stringify((parsed?.invoices ?? []).slice(0, 2))
  );
}

console.log(`\n${pass.length} passed, ${failures.length} failed`);
if (failures.length) {
  console.log("\nFAILURES:");
  for (const f of failures) console.log("  - " + f);
  process.exitCode = 1;
}
