import "server-only";

import {
  Document,
  Image,
  Page,
  Path,
  Svg,
  Text,
  View,
  renderToBuffer,
} from "@react-pdf/renderer";
import type { ReactNode } from "react";

import {
  paperDate,
  paperFor,
  type PaperBlock,
  type PaperDocument,
  type PaperSignature,
} from "@/lib/documents/paper";
import { resolveDocument, resolveShareToken } from "@/lib/queries/share";
import { MARK_VIEWBOX, parseMark } from "@/lib/signing/mark";

/**
 * THE PDF — the document as a real sheet of US Letter.
 *
 * **The same page, printed.** One-inch margins, the letterhead first, the rows
 * and the total, the sentence about the money, and the signature lines — the
 * sections the customer's page draws, in the same order and the same words,
 * because both are drawn from one `PaperDocument`. Attached to the email and
 * downloadable from the link, so the copy that gets forwarded to a spouse or
 * handed to a lender is the real thing rather than a screenshot.
 *
 * **Helvetica, on purpose.** It is built into every PDF reader, so the file
 * needs no font download to render and no font file to ship — and it prints
 * identically on the one printer in the contractor's office and the one at the
 * homeowner's bank.
 */

const INK = "#16202a";
const SOFT = "#667485";
const RULE = "#dfe4ea";

/** Each kind of paper's own ink, as on its miniature — see `inkFor`. */
const KIND_INK: Record<PaperDocument["kind"], string> = {
  quote: "#d97706",
  contract: "#047857",
  change_order: "#6d28d9",
  invoice: "#0369a1",
};

const LABEL = {
  fontFamily: "Helvetica-Bold",
  fontSize: 7.5,
  letterSpacing: 1.1,
  textTransform: "uppercase" as const,
  color: SOFT,
};

export function DocumentPdf({
  paper,
  logo,
}: {
  paper: PaperDocument;
  /** The letterhead's logo, already fetched — or null to leave it off. */
  logo: Buffer | null;
}) {
  const ink = KIND_INK[paper.kind];
  const { letterhead } = paper;

  return (
    <Document
      title={[paper.label, paper.number].filter(Boolean).join(" ")}
      author={letterhead.name ?? undefined}
      creator="ServiceClerk"
      producer="ServiceClerk"
    >
      <Page
        size="LETTER"
        style={{
          paddingTop: 72,
          paddingHorizontal: 72,
          paddingBottom: 96,
          fontFamily: "Helvetica",
          fontSize: 10,
          lineHeight: 1.45,
          color: INK,
        }}
      >
        {paper.demo ? (
          <Text
            style={{
              ...LABEL,
              alignSelf: "flex-start",
              borderWidth: 1,
              borderStyle: "dashed",
              borderColor: SOFT,
              paddingVertical: 3,
              paddingHorizontal: 6,
              marginBottom: 12,
            }}
          >
            Demo · not a real {paper.label.toLowerCase()}
          </Text>
        ) : null}

        {/* The letterhead — who this is from, and that they're licensed. */}
        {logo ? (
          // A PDF image, not an HTML one — react-pdf's has no alt to give.
          // eslint-disable-next-line jsx-a11y/alt-text
          <Image
            src={logo}
            style={{ height: 32, maxWidth: 160, objectFit: "contain", marginBottom: 8 }}
          />
        ) : null}
        {letterhead.name ? (
          <Text style={{ fontFamily: "Helvetica-Bold", fontSize: 13 }}>
            {letterhead.name}
          </Text>
        ) : null}
        {letterhead.license ? (
          <Text style={{ color: SOFT, fontSize: 8.5, marginTop: 2 }}>
            LIC #{letterhead.license}
          </Text>
        ) : null}
        {letterhead.phone ? (
          <Text style={{ color: SOFT, fontSize: 8.5, marginTop: 1 }}>
            {letterhead.phone}
          </Text>
        ) : null}

        <View
          style={{
            flexDirection: "row",
            justifyContent: "space-between",
            marginTop: 12,
            paddingBottom: 14,
            borderBottomWidth: 1,
            borderBottomColor: RULE,
            fontSize: 8.5,
            color: SOFT,
          }}
        >
          <Text>
            {[
              paper.preparedFor ? `Prepared for ${paper.preparedFor}` : null,
              paper.jobAddress,
            ]
              .filter(Boolean)
              .join(" · ")}
          </Text>
          {paper.number ? <Text>{paper.number}</Text> : null}
        </View>

        {/* What this paper is, in its own ink, and what it's for. */}
        <Text style={{ ...LABEL, color: ink, marginTop: 18 }}>{paper.label}</Text>
        <Text style={{ fontFamily: "Helvetica-Bold", fontSize: 13, marginTop: 3 }}>
          {paper.title ?? paper.label}
        </Text>

        {paper.blocks.map((block, index) => (
          <Block key={index} block={block} />
        ))}

        {/* The foot of every page: whose document, and the mark. */}
        <View
          fixed
          style={{
            position: "absolute",
            left: 72,
            right: 72,
            bottom: 44,
            flexDirection: "row",
            justifyContent: "space-between",
            paddingTop: 8,
            borderTopWidth: 1,
            borderTopColor: RULE,
            fontSize: 7.5,
            color: SOFT,
          }}
        >
          {/* Static text only: a `render` prop in here drops the whole
              footer in this version of react-pdf, so no page numbers — the
              number and the business on every page carry a loose sheet. */}
          <Text>{paper.footer}</Text>
          {/* Free-plan documents only, frozen at sending (Billing §2.2). */}
          {paper.promoFooter ? <Text>Made with ServiceClerk</Text> : null}
        </View>
      </Page>
    </Document>
  );
}

function Block({ block }: { block: PaperBlock }) {
  switch (block.kind) {
    case "text":
      return (
        <View style={{ marginTop: 14 }} wrap={false}>
          {block.heading ? <Text style={LABEL}>{block.heading}</Text> : null}
          <Text
            style={{
              marginTop: block.heading ? 4 : 0,
              color: block.quiet ? SOFT : INK,
              fontSize: block.quiet ? 10 : 10.5,
            }}
          >
            {block.body}
          </Text>
        </View>
      );

    case "lines":
      return (
        <View style={{ marginTop: 16 }}>
          {block.heading ? (
            <Text style={{ ...LABEL, marginBottom: 4 }}>{block.heading}</Text>
          ) : null}
          {block.lines.map((line, index) => (
            <Row key={index} depth={line.depth ?? 0}>
              <View style={{ flex: 1, paddingRight: 16 }}>
                <Text>{line.description}</Text>
                {line.detail ? (
                  <Text style={{ fontSize: 8.5, color: SOFT, marginTop: 1 }}>
                    {line.detail}
                  </Text>
                ) : null}
              </View>
              {line.amount ? <Text>{line.amount}</Text> : null}
            </Row>
          ))}
        </View>
      );

    case "totals":
      return (
        <View style={{ marginTop: block.lines.length ? 0 : 0 }} wrap={false}>
          {block.lines.map((line, index) => (
            <Row key={index} muted>
              <Text>{line.label}</Text>
              <Text>{line.value}</Text>
            </Row>
          ))}
          <View
            style={{
              flexDirection: "row",
              justifyContent: "space-between",
              alignItems: "flex-end",
              borderTopWidth: 1,
              borderTopColor: INK,
              paddingTop: 8,
            }}
          >
            <Text style={{ ...LABEL, color: INK }}>{block.total.label}</Text>
            <Text style={{ fontFamily: "Helvetica-Bold", fontSize: 17 }}>
              {block.total.value}
            </Text>
          </View>
        </View>
      );

    case "list":
      return (
        <View style={{ marginTop: 14 }} wrap={false}>
          <Text style={LABEL}>{block.heading}</Text>
          {block.items.map((item, index) => (
            <View key={index} style={{ flexDirection: "row", marginTop: 3 }}>
              <Text style={{ width: 10, color: SOFT }}>•</Text>
              <Text style={{ flex: 1 }}>{item}</Text>
            </View>
          ))}
        </View>
      );

    case "offer":
      return (
        <View
          wrap={false}
          style={{
            marginTop: 16,
            padding: 10,
            borderWidth: 1,
            borderStyle: "dashed",
            borderColor: SOFT,
          }}
        >
          <Text style={LABEL}>{block.heading}</Text>
          {block.lines.map((line, index) => (
            <View
              key={index}
              style={{ flexDirection: "row", justifyContent: "space-between", marginTop: 4 }}
            >
              <Text style={{ flex: 1, paddingRight: 16 }}>{line.description}</Text>
              <Text>{line.amount}</Text>
            </View>
          ))}
          <Text style={{ fontSize: 8.5, color: SOFT, marginTop: 6 }}>{block.note}</Text>
        </View>
      );

    case "signatures":
      return (
        <View style={{ marginTop: 22 }} wrap={false}>
          <Text style={LABEL}>{block.heading}</Text>
          <Text style={{ fontSize: 8.5, color: SOFT, marginTop: 3 }}>{block.note}</Text>
          <View style={{ flexDirection: "row", marginTop: 6 }}>
            {block.lines.map((line, index) => (
              <SignatureLine key={index} line={line} first={index === 0} />
            ))}
          </View>
        </View>
      );
  }
}

function Row({
  children,
  muted = false,
  depth = 0,
}: {
  children: ReactNode;
  muted?: boolean;
  /** Rows inside a group the customer is shown sit indented and quieter under it. */
  depth?: number;
}) {
  return (
    <View
      wrap={false}
      style={{
        flexDirection: "row",
        justifyContent: "space-between",
        borderTopWidth: 1,
        borderTopColor: RULE,
        paddingVertical: depth ? 4 : 6,
        paddingLeft: depth * 14,
        fontSize: depth ? 9 : undefined,
        color: muted || depth ? SOFT : INK,
      }}
    >
      {children}
    </View>
  );
}

/** Room for a signature whether or not one is there — a printed copy is signed here by hand. */
function SignatureLine({ line, first }: { line: PaperSignature; first: boolean }) {
  const mark = line.mark ? parseMark(line.mark) : null;

  return (
    <View style={{ flex: 1, marginLeft: first ? 0 : 28 }}>
      <View style={{ height: 46, justifyContent: "flex-end", paddingBottom: 2 }}>
        {mark?.kind === "drawn" ? (
          <Svg
            viewBox={`0 0 ${MARK_VIEWBOX.width} ${MARK_VIEWBOX.height}`}
            style={{ width: 126, height: 42 }}
          >
            {mark.paths.map((d, index) => (
              <Path
                key={index}
                d={d}
                fill="none"
                stroke={INK}
                strokeWidth={4}
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            ))}
          </Svg>
        ) : mark ? (
          // Sits on the rule like ink: a tight line box, so the page's
          // line height doesn't push the name down through the line.
          <Text style={{ fontFamily: "Times-Italic", fontSize: 20, lineHeight: 1.1, marginBottom: 3 }}>
            {mark.name}
          </Text>
        ) : null}
      </View>
      <View style={{ borderTopWidth: 1, borderTopColor: INK }} />
      <View
        style={{
          flexDirection: "row",
          justifyContent: "space-between",
          marginTop: 4,
          fontSize: 8.5,
        }}
      >
        <Text style={{ color: line.printedName ? INK : SOFT }}>
          {line.printedName ?? "Signature"}
        </Text>
        <Text style={{ color: SOFT }}>
          {line.signedAt ? paperDate(line.signedAt) : "Date"}
        </Text>
      </View>
      <Text style={{ fontSize: 8.5, color: SOFT, marginTop: 1 }}>
        {line.role ?? line.who}
      </Text>
    </View>
  );
}

/* ── Rendering ─────────────────────────────────────────────────────────── */

export type PdfFile = { filename: string; content: Buffer };

/** A paper, as PDF bytes. */
export async function renderPaperPdf(paper: PaperDocument): Promise<Buffer> {
  const logo = paper.letterhead.logoUrl
    ? await fetchLogo(paper.letterhead.logoUrl)
    : null;
  return renderToBuffer(<DocumentPdf paper={paper} logo={logo} />);
}

/**
 * The PDF that goes out with a send — drafts included, since the email is
 * composed before the document is marked sent. The organization is the
 * caller's to have proved.
 */
export async function documentPdf(
  documentId: string,
  organizationId: string,
  letterhead?: PaperDocument["letterhead"]
): Promise<PdfFile | null> {
  const shared = await resolveDocument(documentId, organizationId);
  if (!shared) return null;
  const paper = paperFor(shared);
  if (letterhead) paper.letterhead = letterhead;
  return { filename: paper.filename, content: await renderPaperPdf(paper) };
}

/** The PDF behind a customer's link — what "Download PDF" hands them. */
export async function sharePdf(token: string): Promise<PdfFile | null> {
  const shared = await resolveShareToken(token);
  if (!shared) return null;
  const paper = paperFor(shared);
  return { filename: paper.filename, content: await renderPaperPdf(paper) };
}

/**
 * The logo, fetched once and handed over as bytes — or null, and the PDF goes
 * without it. A logo that times out or isn't a PNG or JPEG must never stop a
 * contract from being attached.
 */
async function fetchLogo(url: string): Promise<Buffer | null> {
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(4000) });
    if (!response.ok) return null;
    const type = response.headers.get("content-type") ?? "";
    if (!/image\/(png|jpe?g)/.test(type)) return null;
    return Buffer.from(await response.arrayBuffer());
  } catch {
    return null;
  }
}
