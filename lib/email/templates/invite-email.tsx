import { Body, Button, Container, Head, Hr, Html, Preview, Section, Text } from "@react-email/components";

/**
 * THE INVITATION — one person at ServiceClerk asking a contractor to try it.
 *
 * Written as a note from that person, not a system notice: their name up top,
 * their own words if they wrote any, what's been set aside for this contractor,
 * and one button. Replies go to the person who sent it.
 */

const INK = "#16202a";
const SOFT = "#667485";
const RULE = "#e7ebef";
const GROUND = "#f4f6f8";
const AMBER = "#e8a317";
const ON_AMBER = "#1f2933";
const FONT = "Inter, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif";

export function InviteEmail({
  firstName,
  inviter,
  message,
  perks,
  url,
  days,
}: {
  firstName: string | null;
  inviter: string;
  message: string | null;
  /** What's been set aside for them — "Pro, free until March 1". */
  perks: string[];
  url: string;
  days: number;
}) {
  return (
    <Html lang="en">
      <Head />
      <Preview>{`${inviter} invited you to ServiceClerk — manage jobs from the first quote to the final payment.`}</Preview>
      <Body style={{ backgroundColor: GROUND, margin: 0, padding: "32px 0", fontFamily: FONT }}>
        <Container style={{ maxWidth: 520, width: "100%", padding: "0 16px" }}>
          <Text style={{ margin: "0 4px 16px", fontSize: 14, lineHeight: "20px", fontWeight: 700, color: INK }}>ServiceClerk</Text>
          <Section style={{ backgroundColor: "#ffffff", border: `1px solid ${RULE}`, borderRadius: 12, padding: "24px 24px 26px" }}>
            <Text style={{ margin: 0, fontSize: 18, lineHeight: "26px", fontWeight: 600, color: INK }}>
              {firstName ? `${firstName}, you're invited to ServiceClerk` : "You're invited to ServiceClerk"}
            </Text>
            <Text style={{ margin: "8px 0 0", fontSize: 15, lineHeight: "24px", color: INK }}>
              {inviter} invited you to try ServiceClerk: quoting and job management for independent contractors,
              from the first quote to the final payment.
            </Text>
            <Text style={{ margin: "14px 0 0", fontSize: 15, lineHeight: "24px", color: INK }}>
              Keep the scope, customer approvals, schedule, and money together as the job moves forward:
            </Text>
            <ul style={{ margin: "8px 0 0", paddingLeft: 20, fontSize: 15, lineHeight: "24px", color: INK }}>
              <li style={{ marginBottom: 6 }}>Build a quote and turn it into a contract your customer can sign.</li>
              <li style={{ marginBottom: 6 }}>Request percentage-based deposits and send progress bills or draws for job phases.</li>
              <li style={{ marginBottom: 6 }}>Put extra work in a change order, with the scope and price recorded together.</li>
              <li>Manage customers, schedules, and tasks, and track payments through the final invoice.</li>
            </ul>
            <Text style={{ margin: "14px 0 0", fontSize: 15, lineHeight: "24px", color: INK }}>
              Homeowners can review documents, sign, and pay through a shared link without creating an account.
              Online payments require an approved Stripe connection; processing fees apply.
            </Text>
            {message ? (
              <Text
                style={{
                  margin: "16px 0 0",
                  padding: "10px 14px",
                  borderLeft: `3px solid ${AMBER}`,
                  backgroundColor: GROUND,
                  fontSize: 15,
                  lineHeight: "23px",
                  color: INK,
                  whiteSpace: "pre-wrap",
                }}
              >
                {message}
              </Text>
            ) : null}
            {perks.length ? (
              <Section style={{ margin: "16px 0 0" }}>
                <Text style={{ margin: 0, fontSize: 11, lineHeight: "16px", fontWeight: 600, letterSpacing: "0.14em", textTransform: "uppercase", color: SOFT }}>
                  Set aside for you
                </Text>
                {perks.map((perk) => (
                  <Text key={perk} style={{ margin: "6px 0 0", fontSize: 15, lineHeight: "22px", color: INK }}>
                    ✓ {perk}
                  </Text>
                ))}
              </Section>
            ) : null}
            <Button
              href={url}
              style={{
                display: "inline-block",
                marginTop: 20,
                padding: "12px 20px",
                backgroundColor: AMBER,
                color: ON_AMBER,
                borderRadius: 8,
                fontSize: 15,
                lineHeight: "20px",
                fontWeight: 600,
                textDecoration: "none",
              }}
            >
              Accept your invitation
            </Button>
            <Text style={{ margin: "14px 0 0", fontSize: 13, lineHeight: "20px", color: SOFT }}>
              Accept your invitation, choose a password, and set up your business. Start with one job you&apos;re ready to quote.
              The invitation link works for {days} days.
            </Text>
            <Text style={{ margin: "10px 0 0", fontSize: 13, lineHeight: "20px", color: SOFT }}>
              Prefer Google sign-in later? Choose Google on the sign-in page using the same email address that received this invitation.
              A different email address won&apos;t connect to your invited account.
            </Text>
          </Section>
          <Section style={{ padding: "18px 4px 0" }}>
            <Text style={{ margin: 0, fontSize: 12, lineHeight: "18px", color: SOFT }}>
              Not expecting this? You can ignore it — nothing happens unless you accept. Reply to reach {inviter}.
            </Text>
            <Hr style={{ borderColor: RULE, margin: "14px 0 0" }} />
          </Section>
        </Container>
      </Body>
    </Html>
  );
}
