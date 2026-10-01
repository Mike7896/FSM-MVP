import {
  Body,
  Button,
  Container,
  Head,
  Hr,
  Html,
  Link,
  Preview,
  Section,
  Text,
} from "@react-email/components";

/**
 * THE EMAILS WE SEND THE CONTRACTOR — one notification, or the day's summary.
 *
 * **Ours, not the business's.** A document email reads as a letter from the
 * shop; these are the product telling its own user something about their
 * business, so they come from ServiceClerk and look like it — quieter than the
 * customer's email, the same palette.
 *
 * **The subject is the state; the body is the detail** (Content Design §7.6).
 * One button, to the screen that changes the state — never the dashboard.
 *
 * The footer names the exact switch that sent it, so turning it off is one
 * click rather than a hunt.
 */

const INK = "#16202a";
const SOFT = "#667485";
const RULE = "#e7ebef";
const GROUND = "#f4f6f8";
const AMBER = "#e8a317";
const ON_AMBER = "#1f2933";
const FONT =
  "Inter, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif";

export type NotificationItem = {
  title: string;
  body: string;
  url: string;
  action: string;
};

export function NotificationEmail({
  item,
  reason,
  settingsUrl,
}: {
  item: NotificationItem;
  /** The catalog label of the switch that sent it. */
  reason: string | null;
  settingsUrl: string;
}) {
  return (
    <Frame preview={item.body} settingsUrl={settingsUrl} reason={reason ? `"${reason}" is on for email` : null}>
      <Text style={{ margin: 0, fontSize: 18, lineHeight: "26px", fontWeight: 600, color: INK }}>
        {item.title}
      </Text>
      <Text style={{ margin: "8px 0 0", fontSize: 15, lineHeight: "24px", color: INK }}>
        {item.body}
      </Text>
      <ActionButton href={item.url}>{item.action}</ActionButton>
    </Frame>
  );
}

/** The day's notifications in one email, newest first. */
export function DigestEmail({
  items,
  settingsUrl,
}: {
  items: NotificationItem[];
  settingsUrl: string;
}) {
  return (
    <Frame
      preview={items[0]?.title ?? "Your summary"}
      settingsUrl={settingsUrl}
      reason="email is set to once a day"
    >
      <Text
        style={{
          margin: "0 0 4px",
          fontSize: 11,
          lineHeight: "16px",
          fontWeight: 600,
          letterSpacing: "0.14em",
          textTransform: "uppercase",
          color: SOFT,
        }}
      >
        Since your last summary
      </Text>
      {items.map((item, index) => (
        <Section
          key={index}
          style={{ borderTop: index === 0 ? "none" : `1px solid ${RULE}`, padding: "14px 0" }}
        >
          <Text style={{ margin: 0, fontSize: 15, lineHeight: "22px", fontWeight: 600, color: INK }}>
            {item.title}
          </Text>
          <Text style={{ margin: "4px 0 0", fontSize: 14, lineHeight: "21px", color: SOFT }}>
            {item.body}{" "}
            <Link href={item.url} style={{ color: INK, textDecoration: "underline" }}>
              {item.action}
            </Link>
          </Text>
        </Section>
      ))}
    </Frame>
  );
}

function Frame({
  preview,
  settingsUrl,
  reason,
  children,
}: {
  preview: string;
  settingsUrl: string;
  reason: string | null;
  children: React.ReactNode;
}) {
  return (
    <Html lang="en">
      <Head />
      <Preview>{preview}</Preview>
      <Body style={{ backgroundColor: GROUND, margin: 0, padding: "32px 0", fontFamily: FONT }}>
        <Container style={{ maxWidth: 520, width: "100%", padding: "0 16px" }}>
          <Text style={{ margin: "0 4px 16px", fontSize: 14, lineHeight: "20px", fontWeight: 700, color: INK }}>
            ServiceClerk
          </Text>
          <Section
            style={{
              backgroundColor: "#ffffff",
              border: `1px solid ${RULE}`,
              borderRadius: 12,
              padding: "24px 24px 26px",
            }}
          >
            {children}
          </Section>
          <Section style={{ padding: "18px 4px 0" }}>
            <Text style={{ margin: 0, fontSize: 12, lineHeight: "18px", color: SOFT }}>
              You get this because {reason ?? "of your notification settings"}.{" "}
              <Link href={settingsUrl} style={{ color: SOFT, textDecoration: "underline" }}>
                Change it
              </Link>
            </Text>
            <Hr style={{ borderColor: RULE, margin: "14px 0 0" }} />
          </Section>
        </Container>
      </Body>
    </Html>
  );
}

function ActionButton({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <Button
      href={href}
      style={{
        display: "inline-block",
        marginTop: 18,
        padding: "11px 18px",
        backgroundColor: AMBER,
        color: ON_AMBER,
        borderRadius: 8,
        fontSize: 15,
        lineHeight: "20px",
        fontWeight: 600,
        textDecoration: "none",
      }}
    >
      {children}
    </Button>
  );
}
