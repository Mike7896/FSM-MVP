import assert from "node:assert/strict";
import { inviteOrigin } from "../lib/admin/invite-origin";

assert.equal(inviteOrigin("http://localhost:3000", "https://app.example.com/", true), "https://app.example.com");
assert.equal(inviteOrigin("https://untrusted.example", "https://app.example.com", true), "https://app.example.com");
assert.equal(inviteOrigin("http://localhost:3000", undefined, false), "http://localhost:3000");
for (const configured of [undefined, "http://localhost:3000", "https://localhost", "https://127.0.0.1", "https://[::1]", "https://192.168.1.5", "http://app.example.com"]) {
  assert.throws(() => inviteOrigin("https://request.example", configured, true), /public HTTPS/);
}
for (const configured of ["https://user:pass@app.example.com", "https://app.example.com/path", "https://app.example.com?token=x", "https://app.example.com#x", "ftp://app.example.com", "bad-url"]) {
  assert.throws(() => inviteOrigin("http://localhost:3000", configured, true));
}
console.log("Invite URL checks passed: canonical origin, local development, unsafe email URLs, credentials, and invalid base URLs.");
