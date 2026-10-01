import "server-only";

import { paperFor, type PaperDocument } from "@/lib/documents/paper";

import type { EmailLetterhead } from "./templates/document-email";

/**
 * What goes in the envelope with a send: the document drawn as a page for the
 * email's body, and the same page as a PDF to attach — built once, from one
 * reading, so the two cannot disagree.
 *
 * **Never the reason a send fails:** a document that can't be drawn goes out
 * with the plain summary card; a PDF that can't be rendered goes out without
 * an attachment. Either is logged. The link in the email is what the customer
 * needs, and it always works.
 *
 * The share projection and the PDF module are loaded on demand: both read
 * documents through `lib/documents`, whose send operations call this — a
 * static import would close that loop while the modules are still loading.
 */
export async function enclose(
  documentId: string,
  organizationId: string,
  letterhead: EmailLetterhead,
  options: { pdf?: boolean } = {}
): Promise<{
  paper: PaperDocument | null;
  pdf: { filename: string; content: Buffer } | null;
}> {
  let paper: PaperDocument | null = null;
  try {
    const { resolveDocument } = await import("@/lib/queries/share");
    const shared = await resolveDocument(documentId, organizationId);
    // The email's own letterhead: the one the send is about to capture.
    if (shared) paper = { ...paperFor(shared), letterhead };
  } catch (error) {
    console.error("[enclosure] couldn't draw the document", error);
  }
  if (!paper || options.pdf === false) return { paper, pdf: null };

  try {
    const { renderPaperPdf } = await import("@/lib/pdf/document-pdf");
    return {
      paper,
      pdf: { filename: paper.filename, content: await renderPaperPdf(paper) },
    };
  } catch (error) {
    console.error("[enclosure] couldn't render the PDF", error);
    return { paper, pdf: null };
  }
}
