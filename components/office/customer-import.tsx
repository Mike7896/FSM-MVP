"use client";

import Link from "next/link";
import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Upload } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { cn } from "@/lib/utils";
import type { ImportPreview, PreviewRow } from "@/lib/import/customers";

/**
 * Bringing a customer list in — pick the file, read what it would do, then do it.
 *
 * **Review is the feature.** An import that writes on upload is one the
 * contractor has to undo by hand; this one shows every row, what it was
 * matched to and what would happen, and writes only the rows still ticked when
 * they press the button.
 *
 * **Duplicates arrive unticked rather than hidden.** Two people really can
 * share a name, so the decision is theirs — but it has to be a decision, not
 * an accident.
 */
export function CustomerImport() {
  const router = useRouter();
  const fileInput = useRef<HTMLInputElement>(null);
  const [reading, startReading] = useTransition();
  const [fileName, setFileName] = useState<string | null>(null);
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<number | null>(null);

  function read(file: File | null | undefined) {
    if (!file) return;

    setError(null);
    setDone(null);
    setFileName(file.name);

    startReading(async () => {
      const csv = await file.text();

      const response = await fetch("/api/v1/import/customers/preview", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ csv }),
      }).catch(() => null);

      const body = (await response?.json().catch(() => null)) as {
        data?: ImportPreview;
        error?: { message?: string };
      } | null;

      if (!response?.ok || !body?.data) {
        setPreview(null);
        setError(body?.error?.message ?? "Couldn't read that file.");
        return;
      }

      setPreview(body.data);
      // New rows are ticked; anything already here, or unusable, is not.
      setSelected(
        new Set(
          body.data.rows
            .filter((row) => row.verdict === "new")
            .map((row) => row.line)
        )
      );
    });
  }

  async function bringIn() {
    if (!preview) return;

    const rows = preview.rows.filter(
      (row) => selected.has(row.line) && row.verdict !== "invalid"
    );
    if (rows.length === 0) return;

    setBusy(true);
    setError(null);

    const response = await fetch("/api/v1/import/customers", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        rows: rows.map((row) => ({
          name: row.name,
          email: row.email,
          phone: row.phone,
          address: row.address,
          notes: row.notes,
        })),
      }),
    }).catch(() => null);

    const body = (await response?.json().catch(() => null)) as {
      data?: { created: number };
      error?: { message?: string };
    } | null;

    setBusy(false);

    if (!response?.ok || !body?.data) {
      setError(
        body?.error?.message ?? "Nothing was brought in — the write failed."
      );
      return;
    }

    setDone(body.data.created);
    setPreview(null);
    setFileName(null);
    toast.success(
      `${body.data.created} ${body.data.created === 1 ? "customer" : "customers"} brought in.`
    );
    router.refresh();
  }

  const ready = preview?.rows.filter(
    (row) => selected.has(row.line) && row.verdict !== "invalid"
  ).length;

  return (
    <div className="flex flex-col gap-6">
      {/* ── Pick the file ────────────────────────────────────────────── */}
      <div className="flex flex-col items-start gap-4 rounded-lg border p-5 @xl/office:flex-row @xl/office:items-center @xl/office:justify-between">
        <div className="min-w-0">
          <p className="font-medium">Your customer list, as a CSV</p>
          <p className="text-muted-foreground mt-1 text-sm">
            Export it from wherever it lives now — a spreadsheet, or your old
            software. It needs a column for the customer&apos;s name; email,
            phone, address and notes come too if they&apos;re there.
          </p>
        </div>
        <Button
          type="button"
          variant="outline"
          className="shrink-0"
          disabled={reading}
          onClick={() => fileInput.current?.click()}
        >
          {reading ? <Loader2 className="animate-spin" /> : <Upload />}
          {fileName ? "Pick another file" : "Choose a file"}
        </Button>
        <input
          ref={fileInput}
          type="file"
          accept=".csv,text/csv"
          hidden
          onChange={(event) => {
            read(event.target.files?.[0]);
            event.target.value = "";
          }}
        />
      </div>

      {error ? (
        <p role="alert" className="text-destructive text-sm">
          {error}
        </p>
      ) : null}

      {done !== null ? (
        <div className="rounded-lg border p-5">
          <p className="font-medium">
            {done === 0
              ? "Nothing was brought in."
              : `${done} ${done === 1 ? "customer" : "customers"} brought in.`}
          </p>
          <p className="text-muted-foreground mt-1 text-sm">
            They&apos;re in your directory now, ready to hang a job off.
          </p>
          <Button asChild variant="outline" size="sm" className="mt-4">
            <Link href="/customers">See your customers</Link>
          </Button>
        </div>
      ) : null}

      {/* ── What the file would do ───────────────────────────────────── */}
      {preview ? (
        preview.problem ? (
          <div className="border-destructive/50 rounded-lg border p-5">
            <p className="font-medium">That file can&apos;t be read</p>
            <p className="text-muted-foreground mt-1 text-sm">
              {preview.problem}
            </p>
          </div>
        ) : (
          <>
            <div className="rounded-lg border p-5">
              <p className="font-label text-[11px] uppercase">
                {fileName ?? "Your file"}
              </p>
              {/* "Duplicate" covers two different things — somebody already in
                  the directory, and a name repeated further up the same file.
                  The row says which; the summary must not claim only one. */}
              <p className="mt-2 text-sm">
                <strong className="font-medium">{preview.counts.new} new</strong>
                {preview.counts.duplicate > 0
                  ? `, ${preview.counts.duplicate} already here or repeated`
                  : ""}
                {preview.counts.invalid > 0
                  ? `, ${preview.counts.invalid} that can't come in`
                  : ""}
                . Nothing is saved until you press the button.
              </p>

              <div className="text-muted-foreground mt-3 flex flex-col gap-1 text-xs">
                {preview.columns.map((column) => (
                  <p key={column.field}>
                    Reading{" "}
                    <strong className="text-foreground font-medium">
                      {column.heading}
                    </strong>{" "}
                    as {column.label.toLowerCase()}
                  </p>
                ))}
                {preview.ignored.length ? (
                  <p>
                    Ignoring: {preview.ignored.join(", ")} — nothing here reads
                    those.
                  </p>
                ) : null}
              </div>
            </div>

            <div className="overflow-hidden rounded-lg border">
              {preview.rows.map((row, index) => (
                <Row
                  key={row.line}
                  row={row}
                  first={index === 0}
                  checked={selected.has(row.line)}
                  onToggle={(next) =>
                    setSelected((current) => {
                      const copy = new Set(current);
                      if (next) copy.add(row.line);
                      else copy.delete(row.line);
                      return copy;
                    })
                  }
                />
              ))}
            </div>

            <div className="bg-background sticky bottom-0 flex flex-wrap items-center justify-between gap-3 border-t py-4">
              <p className="text-muted-foreground text-sm">
                {ready === 0
                  ? "Nothing ticked."
                  : `${ready} ${ready === 1 ? "customer" : "customers"} will be added.`}
              </p>
              <Button onClick={bringIn} disabled={busy || ready === 0}>
                {busy ? <Loader2 className="animate-spin" /> : null}
                Bring them in
              </Button>
            </div>
          </>
        )
      ) : null}
    </div>
  );
}

function Row({
  row,
  first,
  checked,
  onToggle,
}: {
  row: PreviewRow;
  first: boolean;
  checked: boolean;
  onToggle: (next: boolean) => void;
}) {
  const unusable = row.verdict === "invalid";

  return (
    <label
      className={cn(
        "flex items-start gap-3 px-4 py-3",
        first ? "" : "border-t",
        unusable ? "opacity-60" : "hover:bg-muted/40 cursor-pointer"
      )}
    >
      <Checkbox
        checked={checked}
        disabled={unusable}
        onCheckedChange={(next) => onToggle(next === true)}
        className="mt-0.5"
        aria-label={`Bring in ${row.name || `line ${row.line}`}`}
      />
      <span className="min-w-0 flex-1">
        <span className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
          <span className="text-sm font-medium">
            {row.name || <span className="text-muted-foreground">No name</span>}
          </span>
          <span className="text-muted-foreground text-xs tabular-nums">
            line {row.line}
          </span>
        </span>
        {row.email || row.phone || row.address ? (
          <span className="text-muted-foreground mt-0.5 block truncate text-xs">
            {[row.email, row.phone, row.address].filter(Boolean).join(" · ")}
          </span>
        ) : null}
        {row.reason ? (
          <span
            className={cn(
              "mt-0.5 block text-xs",
              unusable ? "text-destructive" : "text-muted-foreground"
            )}
          >
            {row.reason}
          </span>
        ) : null}
      </span>
    </label>
  );
}
