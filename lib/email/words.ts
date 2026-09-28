/**
 * The words an email starts from, before the contractor has typed any.
 *
 * Kept apart from the templates so the send sheet can put them in its message
 * box and the server can fall back on the same sentence — the words he sees
 * in the box are the words that go. No React, no I/O.
 */

/** "Hi Jean — here's the quote for the panel upgrade. …" */
export function quoteMessage(
  customerName: string | null,
  title: string | null,
  demo = false
): string {
  if (demo) return "My demo quote — open it the way a customer would.";
  const work = title?.trim();
  return `Hi ${firstName(customerName)} — here's the quote${
    work ? ` for the ${work.charAt(0).toLowerCase()}${work.slice(1)}` : ""
  }. Have a look, and let me know if you have any questions.`;
}

export function firstName(name: string | null | undefined): string {
  return name?.trim().split(/\s+/)[0] || "there";
}
