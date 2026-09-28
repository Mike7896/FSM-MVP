import "server-only";

import { render } from "@react-email/components";

import {
  DigestEmail,
  NotificationEmail,
  type NotificationItem,
} from "@/lib/email/templates/notification-email";
import { absoluteUrl } from "@/lib/env";

/**
 * The emails a notification goes out as — one on its own, or the day's
 * summary. Both are rendered from the templates in `lib/email/templates`, with
 * a plain-text version beside the HTML.
 *
 * The subject is the state (Content Design §7.6): a single notification's
 * title, or the newest one's with a count for a summary — so the inbox row is
 * the news before anything is opened.
 */

const SETTINGS = "/settings#notifications";

export async function notificationEmail({
  title,
  body,
  href,
  action,
  reason,
}: {
  title: string;
  body: string;
  href: string;
  action: string;
  /** The catalog label of the preference that sent it. */
  reason: string | null;
}) {
  const element = (
    <NotificationEmail
      item={{ title, body, action, url: absoluteUrl(href) }}
      reason={reason}
      settingsUrl={absoluteUrl(SETTINGS)}
    />
  );

  return {
    subject: title,
    html: await render(element),
    text: await render(element, { plainText: true }),
  };
}

export async function digestEmail(
  items: (Omit<NotificationItem, "url"> & { href: string })[]
) {
  const element = (
    <DigestEmail
      items={items.map(({ href, ...item }) => ({ ...item, url: absoluteUrl(href) }))}
      settingsUrl={absoluteUrl(SETTINGS)}
    />
  );

  const more = items.length - 1;

  return {
    subject: more > 0 ? `${items[0].title} — and ${more} more` : items[0].title,
    html: await render(element),
    text: await render(element, { plainText: true }),
  };
}
