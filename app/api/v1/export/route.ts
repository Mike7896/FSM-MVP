import { requireCaller, requireOrg } from "@/lib/api/auth";
import { handler } from "@/lib/api/handler";
import { ApiError } from "@/lib/api/response";
import { toCsv } from "@/lib/export/csv";
import {
  EXPORT_TABLES,
  exportEverything,
  exportRows,
  isExportTable,
} from "@/lib/export/tables";

/**
 * `GET /api/v1/export` — the shop's own records, on the way out.
 *
 * **Anti-lock-in is the promise that makes import safe**, so this is available
 * always rather than at cancellation, and it is a plain download rather than a
 * job that emails a link later: a contractor asking for their data should get
 * it in the time it takes to open a file.
 *
 * `?table=` gives one set as CSV, for the spreadsheet a bookkeeper wants.
 * Nothing, or `?format=json`, gives everything in one file — the machine copy
 * for taking to another system.
 *
 * **Not `ok()`.** Every other endpoint answers a `{data}` envelope; this one
 * answers a file, because the browser has to be able to save it. It is still a
 * route handler with the same authentication, and the native app can call it
 * with a bearer token exactly like the rest of the API.
 */
export const GET = handler(async (request) => {
  const caller = await requireCaller(request);
  const { organizationId } = await requireOrg(request, caller);

  const url = new URL(request.url);
  const table = url.searchParams.get("table");
  const stamp = new Date().toISOString().slice(0, 10);

  if (table) {
    if (!isExportTable(table)) {
      throw new ApiError(
        "invalid_request",
        `There's nothing called "${table}" to export. Ask for one of: ${EXPORT_TABLES.map((row) => row.id).join(", ")}.`
      );
    }

    const set = await exportRows(organizationId, table);

    return new Response(toCsv(set.rows, set.columns), {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="${table}-${stamp}.csv"`,
        // A shop's own records, and a stale copy is a wrong copy.
        "Cache-Control": "no-store",
      },
    });
  }

  const everything = await exportEverything(organizationId);
  // Rows only in the one file: JSON carries its own keys, so a separate list
  // of headings would just be the same words twice.
  const sets = Object.fromEntries(
    Object.entries(everything).map(([table, set]) => [table, set.rows])
  );

  return new Response(
    JSON.stringify({ exportedAt: new Date().toISOString(), ...sets }, null, 2),
    {
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Content-Disposition": `attachment; filename="everything-${stamp}.json"`,
        "Cache-Control": "no-store",
      },
    }
  );
});
