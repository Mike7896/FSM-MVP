/** Isolated proxy regression checks: real NextRequest/Response, mocked Auth service. */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import vm from "node:vm";
import ts from "typescript";
import { NextRequest, type NextResponse } from "next/server";
import type { CookieOptionsWithName } from "@supabase/ssr";
import { safeNextPath } from "../lib/safe-next";
import { purchaseQuery, signupDestination } from "../lib/membership/purchase-intent";

const require = createRequire(import.meta.url);
const source = readFileSync(new URL("../lib/supabase/proxy.ts", import.meta.url), "utf8");
const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
let claims: object | null = null;
let user: object | null = null;
let error: object | null = null;
let checks = 0;
let writeCookies = false;
const exports = {} as { updateSession: (request: NextRequest) => Promise<NextResponse> };
type MockOptions = { cookies: { setAll: (cookies: { name: string; value: string; options: CookieOptionsWithName }[], headers: Record<string, string>) => void } };
vm.runInNewContext(compiled, {
  exports, URL,
  require(id: string) {
    if (id === "@supabase/ssr") return { createServerClient: (_url: string, _key: string, options: MockOptions) => ({ auth: {
      getClaims: async () => {
        if (writeCookies) options.cookies.setAll([{ name: "session", value: "rotated", options: { path: "/", httpOnly: true } }], { "cache-control": "private, no-store" });
        return { data: claims ? { claims } : null };
      },
      getUser: async () => { checks++; return { data: { user }, error }; },
    } }) };
    if (id === "@/lib/env") return { clientEnv: { NEXT_PUBLIC_SUPABASE_URL: "https://auth.invalid", NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "test" } };
    if (id === "@/lib/safe-next") return { safeNextPath };
    if (id === "@/lib/membership/purchase-intent") return { purchaseQuery, signupDestination };
    return require(id);
  },
});
const request = (path: string) => exports.updateSession(new NextRequest(`https://app.test${path}`));
let passed = 0;
async function test(name: string, run: () => Promise<void>) {
  claims = null; user = null; error = null; checks = 0; writeCookies = false;
  await run(); passed++; console.log(`PASS ${name}`);
}
await test("anonymous protected URL preserves its destination", async () => {
  const result = await request("/quotes?status=draft");
  assert.equal(result.headers.get("location"), "https://app.test/login?next=%2Fquotes%3Fstatus%3Ddraft");
  assert.equal(checks, 0);
});
await test("deleted account with valid claims stops at login and signup", async () => {
  claims = { sub: "deleted-user" }; error = { message: "User not found" };
  for (const path of ["/login", "/signup", "/login?next=/dashboard"]) {
    const result = await request(path);
    assert.equal(result.status, 200); assert.equal(result.headers.get("location"), null);
  }
  assert.equal(checks, 3);
});
await test("null user and transient auth failure both leave recovery accessible", async () => {
  claims = { sub: "old-user" };
  assert.equal((await request("/login")).status, 200);
  user = { id: "old-user" }; error = { message: "Auth unavailable" };
  assert.equal((await request("/login")).status, 200);
});
await test("valid account follows next and preserves refreshed cookie headers", async () => {
  claims = { sub: "active-user" }; user = { id: "active-user" }; writeCookies = true;
  const result = await request("/login?next=/quotes");
  assert.equal(result.headers.get("location"), "https://app.test/quotes");
  assert.equal(result.cookies.get("session")?.value, "rotated");
  assert.equal(result.headers.get("cache-control"), "private, no-store");
});
await test("failed live check preserves refreshed cookies on the rendered login", async () => {
  claims = { sub: "deleted-user" }; writeCookies = true;
  const result = await request("/login");
  assert.equal(result.status, 200); assert.equal(result.cookies.get("session")?.value, "rotated");
});
await test("signup retains purchase intent", async () => {
  claims = { sub: "active-user" }; user = { id: "active-user" };
  assert.equal((await request("/signup?plan=pro&interval=year")).headers.get("location"), "https://app.test/welcome?plan=pro&interval=year");
});
await test("auth destinations and external destinations cannot redirect in a loop", async () => {
  claims = { sub: "active-user" }; user = { id: "active-user" };
  for (const next of ["/login", "/signup", "https://evil.test", "//evil.test"]) {
    assert.equal((await request(`/login?next=${encodeURIComponent(next)}`)).headers.get("location"), "https://app.test/dashboard");
  }
});
await test("API, public pages and protected pages do not add live checks", async () => {
  claims = { sub: "user" };
  for (const path of ["/api/v1/quotes", "/pricing", "/dashboard", "/forgot-password", "/reset-password"]) assert.equal((await request(path)).status, 200);
  assert.equal(checks, 0);
});
console.log(`${passed} auth redirect regression checks passed.`);
