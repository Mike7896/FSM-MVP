import type { ReactNode } from "react";
import {
  Body,
  Button,
  Column,
  Container,
  Head,
  Hr,
  Html,
  Img,
  Link,
  Preview,
  Row,
  Section,
  Text,
} from "@react-email/components";

import {
  paperDate,
  type PaperBlock,
  type PaperDocument,
  type PaperSignature,
} from "@/lib/documents/paper";
import { parseMark } from "@/lib/signing/mark";

/**
 * THE EMAIL A DOCUMENT GOES OUT IN — one layout, every document.
 *
 * **A letter with the document enclosed.** The contractor's note comes first,
 * as he wrote it; under it the document itself, drawn as a sheet of paper —
 * the same letterhead, rows, total and terms as the page on her link and the
 * PDF attached, because all three are drawn from one `PaperDocument`. The
 * button sits **below the page, not on it**: the paper is the thing she's
 * agreeing to, and a button printed on a contract is furniture.
 *
 * **The business's email, not ours.** Their letterhead, their words, their
 * name in the From line and on the reply. Our mark is one small line at the
 * very bottom, the same place it sits on the paper.
 *
 * **Built for the inbox, not the browser.** Email clients strip stylesheets,
 * ignore web fonts, drop SVG and lay out tables, so everything here is inline
 * style on React Email's table-based primitives — no class names, nothing a
 * mail client can drop on the floor. A drawn signature can't be shown without
 * SVG, so a signed line says it's signed and the PDF carries the mark.
 */

/** The brand kit's palette, as literal values — see `app/globals.css`. */
const INK = "#16202a";
const SOFT = "#667485";
const RULE = "#e3e7ec";
const GROUND = "#eef1f4";
const AMBER = "#e8a317";
const ON_AMBER = "#1f2933";

/** Each kind of paper's own ink, as on its miniature — see `inkFor`. */
const KIND_INK: Record<PaperDocument["kind"], string> = {
  quote: "#d97706",
  contract: "#047857",
  change_order: "#6d28d9",
  invoice: "#0369a1",
};

const FONT =
  "Inter, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif";

const LABEL = {
  margin: 0,
  fontSize: 10,
  lineHeight: "14px",
  fontWeight: 700,
  letterSpacing: "0.14em",
  textTransform: "uppercase" as const,
  color: SOFT,
};

export type EmailLetterhead = {
  name: string | null;
  logoUrl: string | null;
  license: string | null;
  phone: string | null;
};

/**
 * The document in brief — what stands in for the page when there isn't one to
 * draw, and where the action comes from either way.
 */
export type DocumentCard = {
  /** "Quote · Q-0006" — what this is, in the document's own words. */
  eyebrow: string;
  title: string | null;
  rows: { label: string; value: string; strong?: boolean }[];
  action: { label: string; url: string | null };
};

export function DocumentEmail({
  letterhead,
  preview,
  message,
  card,
  paper,
  attached = false,
  demo = false,
}: {
  letterhead: EmailLetterhead;
  /** The line an inbox shows beside the subject. */
  preview: string;
  /** The contractor's words, as he left them. Blank lines are paragraphs. */
  message: string;
  card: DocumentCard;
  /** The document, drawn as its page. Left out, the card is shown instead. */
  paper?: PaperDocument | null;
  /** A PDF of it rides along, so the email says so. */
  attached?: boolean;
  demo?: boolean;
}) {
  const business = letterhead.name?.trim() || "Your contractor";

  return (
    <Html lang="en">
      <Head />
      <Preview>{preview}</Preview>
      <Body style={{ backgroundColor: GROUND, margin: 0, padding: "28px 0 36px", fontFamily: FONT }}>
        <Container style={{ maxWidth: 640, width: "100%", padding: "0 12px" }}>
          {demo ? (
            <Text
              style={{
                margin: "0 0 16px",
                padding: "8px 12px",
                border: `1px dashed ${SOFT}`,
                borderRadius: 6,
                fontSize: 13,
                lineHeight: "18px",
                color: SOFT,
              }}
            >
              This is a demo. It went only to you, and nothing on it counts.
            </Text>
          ) : null}

          {/* The covering note — his words, before the document. */}
          <Section style={{ padding: "0 4px 18px" }}>
            {paragraphs(message).map((paragraph, index) => (
              <Text
                key={index}
                style={{ margin: "0 0 12px", fontSize: 16, lineHeight: "25px", color: INK }}
              >
                {paragraph.map((line, at) => (
                  <span key={at}>
                    {at > 0 ? <br /> : null}
                    {line}
                  </span>
                ))}
              </Text>
            ))}
          </Section>

          {paper ? <Sheet paper={paper} /> : <Card letterhead={letterhead} card={card} />}

          {/* What to do with it — below the page, never on it. */}
          <Section style={{ padding: "22px 4px 0" }}>
            <Button
              href={card.action.url ?? undefined}
              style={{
                display: "block",
                padding: "14px 20px",
                backgroundColor: AMBER,
                color: ON_AMBER,
                borderRadius: 8,
                fontSize: 16,
                lineHeight: "22px",
                fontWeight: 600,
                textAlign: "center",
                textDecoration: "none",
              }}
            >
              {card.action.label}
            </Button>
            {attached ? (
              <Text style={{ margin: "14px 0 0", fontSize: 13, lineHeight: "19px", color: SOFT, textAlign: "center" }}>
                A PDF copy is attached, to save or print.
              </Text>
            ) : null}
            {card.action.url ? (
              // The fallback for clients that mangle buttons, and for anyone who
              // wants to see where a link goes before tapping it.
              <Text style={{ margin: "14px 0 0", fontSize: 13, lineHeight: "19px", color: SOFT }}>
                Button not working? Open this link:{" "}
                <Link href={card.action.url} style={{ color: INK, wordBreak: "break-all" }}>
                  {card.action.url}
                </Link>
              </Text>
            ) : null}
          </Section>

          <Section style={{ padding: "18px 4px 0" }}>
            <Text style={{ margin: 0, fontSize: 13, lineHeight: "19px", color: SOFT }}>
              Questions? Reply to this email — it goes straight to {business}.
            </Text>
            <Hr style={{ borderColor: RULE, margin: "16px 0" }} />
            <Text style={{ margin: 0, fontSize: 12, lineHeight: "18px", color: SOFT }}>
              Sent by {business} with ServiceClerk. No account needed to open it.
            </Text>
          </Section>
        </Container>
      </Body>
    </Html>
  );
}

/* ── The page ──────────────────────────────────────────────────────────── */

/**
 * The document as a sheet — white, with a margin all round, on the grey of
 * the inbox. Not a literal eleven inches: an email has no page length, so it
 * keeps the page's margins and order and lets the sheet end where the
 * document does.
 */
function Sheet({ paper }: { paper: PaperDocument }) {
  const { letterhead } = paper;

  return (
    <Section
      style={{
        backgroundColor: "#ffffff",
        border: `1px solid ${RULE}`,
        padding: "40px 36px 28px",
        boxShadow: "0 1px 3px rgba(22,32,42,0.08)",
      }}
    >
      {paper.demo ? (
        <Text style={{ ...LABEL, display: "inline-block", border: `1px dashed ${SOFT}`, padding: "3px 6px", marginBottom: 14 }}>
          Demo · not a real {paper.label.toLowerCase()}
        </Text>
      ) : null}

      {letterhead.logoUrl ? (
        <Img
          src={letterhead.logoUrl}
          alt={letterhead.name ?? ""}
          height={36}
          style={{ height: 36, width: "auto", maxWidth: 170, marginBottom: 10 }}
        />
      ) : null}
      {letterhead.name ? (
        <Text style={{ margin: 0, fontSize: 17, lineHeight: "22px", fontWeight: 700, color: INK }}>
          {letterhead.name}
        </Text>
      ) : null}
      {letterhead.license || letterhead.phone ? (
        <Text style={{ margin: "3px 0 0", fontSize: 12, lineHeight: "17px", color: SOFT }}>
          {[letterhead.license ? `LIC #${letterhead.license}` : null, letterhead.phone]
            .filter(Boolean)
            .join(" · ")}
        </Text>
      ) : null}

      <Row style={{ marginTop: 14 }}>
        <Column style={{ fontSize: 12, lineHeight: "17px", color: SOFT, paddingBottom: 14, borderBottom: `1px solid ${RULE}` }}>
          {[paper.preparedFor ? `Prepared for ${paper.preparedFor}` : null, paper.jobAddress]
            .filter(Boolean)
            .join(" · ")}
        </Column>
        <Column align="right" style={{ fontSize: 12, lineHeight: "17px", color: SOFT, paddingBottom: 14, borderBottom: `1px solid ${RULE}`, whiteSpace: "nowrap" }}>
          {paper.number ?? ""}
        </Column>
      </Row>

      <Text style={{ ...LABEL, color: KIND_INK[paper.kind], margin: "20px 0 0" }}>
        {paper.label}
      </Text>
      <Text style={{ margin: "4px 0 0", fontSize: 18, lineHeight: "24px", fontWeight: 700, color: INK }}>
        {paper.title ?? paper.label}
      </Text>

      {paper.blocks.map((block, index) => (
        <Block key={index} block={block} />
      ))}

      <Row style={{ marginTop: 28 }}>
        <Column style={{ fontSize: 11, lineHeight: "16px", color: SOFT, paddingTop: 10, borderTop: `1px solid ${RULE}` }}>
          {paper.footer}
        </Column>
        {paper.promoFooter ? (
          <Column align="right" style={{ fontSize: 11, lineHeight: "16px", color: SOFT, paddingTop: 10, borderTop: `1px solid ${RULE}`, whiteSpace: "nowrap" }}>
            Made with ServiceClerk
          </Column>
        ) : null}
      </Row>
    </Section>
  );
}

function Block({ block }: { block: PaperBlock }) {
  switch (block.kind) {
    case "text":
      return (
        <Section style={{ marginTop: 16 }}>
          {block.heading ? <Text style={LABEL}>{block.heading}</Text> : null}
          <Text
            style={{
              margin: block.heading ? "5px 0 0" : 0,
              fontSize: 15,
              lineHeight: "23px",
              color: block.quiet ? SOFT : INK,
            }}
          >
            {block.body}
          </Text>
        </Section>
      );

    case "lines":
      return (
        <Section style={{ marginTop: 18 }}>
          {block.heading ? <Text style={{ ...LABEL, marginBottom: 6 }}>{block.heading}</Text> : null}
          {block.lines.map((line, index) => (
            <Line key={index} left={
              <>
                {line.description}
                {line.detail ? (
                  <span style={{ display: "block", fontSize: 12, lineHeight: "17px", color: SOFT }}>
                    {line.detail}
                  </span>
                ) : null}
              </>
            } right={line.amount ?? ""} />
          ))}
        </Section>
      );

    case "phase":
      return (
        <Section style={{ marginTop: 18 }}>
          <Text style={{ ...LABEL, color: INK, marginBottom: 6 }}>{block.heading}</Text>
          {block.lines.map((line, index) => (
            <Line key={index} left={line.description} right={line.amount ?? ""} muted={Boolean(line.depth)} />
          ))}
          <Line
            left={
              <>
                <strong>{block.bill.label}</strong>
                {block.bill.note ? (
                  <span style={{ display: "block", fontSize: 12, lineHeight: "17px", color: SOFT }}>
                    {block.bill.note}
                  </span>
                ) : null}
              </>
            }
            right={block.bill.value}
          />
        </Section>
      );

    case "totals":
      return (
        <Section>
          {block.lines.map((line, index) => (
            <Line key={index} left={line.label} right={line.value} muted />
          ))}
          <Row>
            <Column style={{ ...LABEL, color: INK, paddingTop: 12, borderTop: `1px solid ${INK}` }}>
              {block.total.label}
              <span style={{ fontSize: 0, lineHeight: 0, color: "transparent" }}>: </span>
            </Column>
            <Column align="right" style={{ paddingTop: 8, borderTop: `1px solid ${INK}`, fontSize: 24, lineHeight: "30px", fontWeight: 700, color: INK, whiteSpace: "nowrap" }}>
              {block.total.value}
            </Column>
          </Row>
        </Section>
      );

    case "list":
      return (
        <Section style={{ marginTop: 16 }}>
          <Text style={LABEL}>{block.heading}</Text>
          {block.items.map((item, index) => (
            <Text key={index} style={{ margin: "4px 0 0", fontSize: 14, lineHeight: "21px", color: INK }}>
              • {item}
            </Text>
          ))}
        </Section>
      );

    case "offer":
      return (
        <Section style={{ marginTop: 18, padding: "12px 14px", border: `1px dashed ${SOFT}` }}>
          <Text style={LABEL}>{block.heading}</Text>
          {block.lines.map((line, index) => (
            <Row key={index}>
              <Column style={{ paddingTop: 6, fontSize: 14, lineHeight: "20px", color: INK }}>
                {line.description}
              </Column>
              <Column align="right" style={{ paddingTop: 6, fontSize: 14, lineHeight: "20px", color: INK, whiteSpace: "nowrap" }}>
                {line.amount}
              </Column>
            </Row>
          ))}
          <Text style={{ margin: "8px 0 0", fontSize: 12, lineHeight: "17px", color: SOFT }}>{block.note}</Text>
        </Section>
      );

    case "signatures":
      return (
        <Section style={{ marginTop: 24 }}>
          <Text style={LABEL}>{block.heading}</Text>
          <Text style={{ margin: "4px 0 0", fontSize: 12, lineHeight: "17px", color: SOFT }}>{block.note}</Text>
          <Row style={{ marginTop: 8 }}>
            {block.lines.map((line, index) => (
              <Column key={index} style={{ width: "50%", verticalAlign: "bottom", paddingLeft: index ? 14 : 0, paddingRight: index ? 0 : 14 }}>
                <SignatureLine line={line} />
              </Column>
            ))}
          </Row>
        </Section>
      );
  }
}

function Line({ left, right, muted = false }: { left: ReactNode; right: string; muted?: boolean }) {
  const color = muted ? SOFT : INK;
  return (
    <Row>
      <Column style={{ padding: "9px 12px 9px 0", borderTop: `1px solid ${RULE}`, fontSize: 14, lineHeight: "20px", color }}>
        {left}
        <span style={{ fontSize: 0, lineHeight: 0, color: "transparent" }}>: </span>
      </Column>
      <Column align="right" style={{ padding: "9px 0", borderTop: `1px solid ${RULE}`, fontSize: 14, lineHeight: "20px", color, whiteSpace: "nowrap", verticalAlign: "top" }}>
        {right}
      </Column>
    </Row>
  );
}

function SignatureLine({ line }: { line: PaperSignature }) {
  const mark = line.mark ? parseMark(line.mark) : null;

  return (
    <>
      <Text style={{ margin: 0, height: 34, paddingTop: 6, fontSize: mark?.kind === "typed" ? 22 : 12, lineHeight: "28px", color: mark?.kind === "typed" ? INK : SOFT, fontFamily: mark?.kind === "typed" ? "'Segoe Script', 'Brush Script MT', 'Snell Roundhand', cursive" : FONT }}>
        {mark?.kind === "typed" ? mark.name : mark ? "✓ Signed" : " "}
      </Text>
      <Row>
        <Column style={{ borderTop: `1px solid ${INK}`, paddingTop: 5, fontSize: 12, lineHeight: "17px", color: line.printedName ? INK : SOFT }}>
          {line.printedName ?? "Signature"}
        </Column>
        <Column align="right" style={{ borderTop: `1px solid ${INK}`, paddingTop: 5, fontSize: 12, lineHeight: "17px", color: SOFT, whiteSpace: "nowrap" }}>
          {line.signedAt ? paperDate(line.signedAt) : "Date"}
        </Column>
      </Row>
      <Text style={{ margin: "2px 0 0", fontSize: 12, lineHeight: "17px", color: SOFT }}>
        {line.role ?? line.who}
      </Text>
    </>
  );
}

/* ── The card — for when there's no page to draw ───────────────────────── */

function Card({ letterhead, card }: { letterhead: EmailLetterhead; card: DocumentCard }) {
  const business = letterhead.name?.trim() || "Your contractor";
  return (
    <Section style={{ backgroundColor: "#ffffff", border: `1px solid ${RULE}`, borderRadius: 10, padding: "24px 24px 20px" }}>
      <Text style={{ margin: 0, fontSize: 17, lineHeight: "22px", fontWeight: 700, color: INK }}>{business}</Text>
      <Text style={{ ...LABEL, margin: "16px 0 0" }}>{card.eyebrow}</Text>
      {card.title ? (
        <Text style={{ margin: "4px 0 0", fontSize: 18, lineHeight: "24px", fontWeight: 600, color: INK }}>{card.title}</Text>
      ) : null}
      <Section style={{ marginTop: 12 }}>
        {card.rows.map((row) => (
          <Line key={row.label} left={row.label} right={row.value} muted={!row.strong} />
        ))}
      </Section>
    </Section>
  );
}

/** Blank lines split paragraphs; single line breaks stay line breaks. */
function paragraphs(text: string): string[][] {
  return text
    .trim()
    .split(/\n{2,}/)
    .filter(Boolean)
    .map((block) => block.split("\n"));
}
