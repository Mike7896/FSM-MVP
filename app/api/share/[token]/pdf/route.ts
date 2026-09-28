import { handlerWithParams } from "@/lib/api/handler";
import { ApiError } from "@/lib/api/response";
import { sharePdf } from "@/lib/pdf/document-pdf";

/**
 * `GET /api/share/[token]/pdf` — the document behind a customer's link, as a
 * PDF on US Letter. "Download PDF" on the link.
 *
 * The token is the permission, as for everything under `/share`: whoever can
 * open the page can take a copy of it. `?download=1` asks the browser to save
 * it rather than open it.
 */
export const GET = handlerWithParams<{ token: string }>(
  async (request, { token }) => {
    const pdf = await sharePdf(token);
    if (!pdf) throw new ApiError("not_found", "No document at that link.");

    const disposition =
      request.nextUrl.searchParams.get("download") === "1" ? "attachment" : "inline";

    return new Response(new Uint8Array(pdf.content), {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `${disposition}; filename="${pdf.filename.replace(/"/g, "")}"`,
        // A copy of a document that can still change — a quote she hasn't
        // answered — is never served stale.
        "Cache-Control": "private, no-store",
        "X-Robots-Tag": "noindex",
      },
    });
  }
);
