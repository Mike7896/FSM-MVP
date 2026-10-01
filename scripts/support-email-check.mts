/** Uses a mocked transport; cannot send any email. */
import assert from "node:assert/strict";
import { sendEmail } from "../lib/email/send";
import { escapeHtml } from "../lib/email/escape";

process.env.RESEND_API_KEY = "mock-only";
process.env.EMAIL_FROM = "support@example.com";
const originalFetch = globalThis.fetch;
let calls = 0;
try {
  globalThis.fetch = async (url, init) => {
    calls++;
    assert.equal(url, "https://api.resend.com/emails");
    assert.equal(new Headers(init?.headers).get("Idempotency-Key"), "support-reply/test");
    const payload = JSON.parse(String(init?.body));
    assert.equal(payload.reply_to, "inbox@example.com");
    assert.deepEqual(payload.to, ["customer@example.com"]);
    assert.equal(payload.html, "&lt;script&gt;test&lt;/script&gt;");
    return Response.json({ id: "mock-accepted" });
  };
  const message = { idempotencyKey: "support-reply/test", to: "customer@example.com", replyTo: "inbox@example.com", subject: "Support reply", text: "<script>test</script>", html: escapeHtml("<script>test</script>") };
  assert.equal((await sendEmail(message)).id, "mock-accepted");
  assert.equal(calls, 1);
  globalThis.fetch = async () => Response.json({ message: "Provider unavailable" }, { status: 503 });
  await assert.rejects(sendEmail(message), /Provider unavailable/);
  globalThis.fetch = async () => Response.json({});
  await assert.rejects(sendEmail(message), /refused/);
  console.log("Mock email checks passed: idempotency header, recipient, reply-to, escaping, accepted ID, provider failure, malformed response. No email sent.");
} finally { globalThis.fetch = originalFetch; }
