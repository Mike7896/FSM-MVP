import { AlertTriangle, Check, ShieldCheck } from "lucide-react";

import { SignatureMark } from "@/components/signing/signature-mark";
import { Separator } from "@/components/ui/separator";
import type { Certificate } from "@/lib/signing/certificate";
import { cn } from "@/lib/utils";

/**
 * THE CERTIFICATE OF COMPLETION.
 *
 * The page an e-signature vendor prints at the end, and the artifact that
 * actually does the work when somebody disputes a charge seven months later.
 * The signature image is decoration; this is the evidence.
 *
 * **It is built to be printable and to be read by a stranger.** An adjuster or
 * an issuer's analyst has never seen this product, so nothing here is stated in
 * our vocabulary — the hash is named and shown, the consent is dated, and the
 * exceptions are listed at the top rather than left for someone to notice.
 *
 * **It can say that something is wrong.** `complete` is recomputed from the
 * live document every time this renders, so a mismatch between what was signed
 * and what is stored surfaces here loudly. A certificate that can only ever say
 * "verified" is a graphic, not a control.
 */
export function SignatureCertificate({
  certificate,
  className,
}: {
  certificate: Certificate;
  className?: string;
}) {
  const { document: doc, signatures, exceptions, complete } = certificate;

  return (
    <div className={cn("mx-auto flex w-full max-w-2xl flex-col gap-6", className)}>
      <header className="flex items-start justify-between gap-4">
        <div>
          <p className="text-muted-foreground font-label text-[11px] uppercase">
            Certificate of completion
          </p>
          <h1 className="mt-1 text-xl font-medium">
            {doc.title ?? doc.number}
          </h1>
          <p className="text-muted-foreground mt-1 text-sm">
            {doc.number} · {doc.businessName ?? "—"} and {doc.customerName ?? "—"}
            {doc.jobAddress ? ` · ${doc.jobAddress}` : ""}
          </p>
        </div>

        <div
          className={cn(
            "flex shrink-0 items-center gap-1.5 rounded-full border px-3 py-1 text-xs",
            complete
              ? "text-foreground"
              : "border-destructive/50 text-destructive"
          )}
        >
          {complete ? (
            <ShieldCheck className="size-3.5" />
          ) : (
            <AlertTriangle className="size-3.5" />
          )}
          {complete ? "Verified" : "Needs review"}
        </div>
      </header>

      {exceptions.length > 0 ? (
        <div className="border-destructive/50 rounded-xl border border-l-4 p-5">
          <p className="text-destructive text-sm font-medium">
            {exceptions.length === 1
              ? "One thing to know about this record"
              : `${exceptions.length} things to know about this record`}
          </p>
          <ul className="mt-2 flex flex-col gap-1.5">
            {exceptions.map((exception) => (
              <li key={exception} className="text-muted-foreground text-xs leading-relaxed">
                {exception}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <Separator />

      <section className="flex flex-col gap-6">
        {signatures.length === 0 ? (
          <p className="text-muted-foreground text-sm">
            No signatures have been recorded on this document.
          </p>
        ) : null}

        {signatures.map((signature) => (
          <div key={`${signature.party}-${signature.signedAt.toISOString()}`}>
            <div className="flex items-baseline justify-between gap-4">
              <p className="font-label text-[11px] uppercase">
                {signature.party === "contractor" ? "Contractor" : "Customer"}
              </p>
              {signature.integrity.verified ? (
                <span className="text-muted-foreground flex items-center gap-1 text-xs">
                  <Check className="size-3" />
                  Content verified
                </span>
              ) : signature.integrity.recorded === null ? (
                // Nothing to compare against is not the same finding as a
                // comparison that failed, and the record says which.
                <span className="text-muted-foreground flex items-center gap-1 text-xs">
                  <AlertTriangle className="size-3" />
                  No fingerprint recorded
                </span>
              ) : (
                <span className="text-destructive flex items-center gap-1 text-xs">
                  <AlertTriangle className="size-3" />
                  Content does not match
                </span>
              )}
            </div>

            <div className="mt-3 border-b pb-2">
              <SignatureMark value={signature.mark.value} />
            </div>

            <dl className="mt-3 grid gap-x-6 gap-y-2 text-xs sm:grid-cols-2">
              <Row label="Signed by" value={signature.printedName} />
              <Row label="Signed at" value={stamp(signature.signedAt)} />
              <Row
                label="Consented to e-signing"
                value={
                  signature.consentedAt
                    ? stamp(signature.consentedAt)
                    : signature.party === "contractor"
                      ? "Applied from the business's stored signature"
                      : "Not recorded"
                }
              />
              <Row
                label="Signature type"
                value={signature.mark.kind === "drawn" ? "Drawn" : "Typed"}
              />
              <Row label="Email on file" value={signature.signerEmail ?? "—"} />
              <Row
                label="Authenticated by"
                value={
                  signature.authMethod === "share_link"
                    ? "Private link sent to the signer"
                    : "Signed-in account"
                }
              />
              <Row label="IP recorded" value={signature.ip ?? "—"} />
              <Row label="Device" value={shorten(signature.userAgent)} />
            </dl>
          </div>
        ))}
      </section>

      <Separator />

      <section>
        <p className="font-label text-[11px] uppercase">
          Document fingerprint
        </p>
        <p className="text-muted-foreground mt-1 text-xs leading-relaxed">
          {certificate.hashAlgorithm} of the document&apos;s content — the
          header, the terms, every priced line and the amounts. Recomputed each
          time this page is produced and compared against the value stored with
          each signature, so a change to the document after signing shows up
          here rather than going unnoticed.
        </p>
        <p className="bg-muted mt-2 overflow-x-auto rounded-md p-2 font-mono text-[10px] break-all">
          {certificate.currentHash}
        </p>
        {doc.frozenAt ? (
          <p className="text-muted-foreground mt-2 text-xs">
            This record has been locked against editing since{" "}
            {stamp(doc.frozenAt)}.
          </p>
        ) : null}
      </section>

      <p className="text-muted-foreground text-[11px]">
        Produced {stamp(certificate.generatedAt)} · consent disclosure{" "}
        {certificate.disclosureVersion}
      </p>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="mt-1 break-words">{value}</dd>
    </div>
  );
}

/** Timestamps carry their zone — "3:14 PM" with no offset is not evidence. */
function stamp(date: Date): string {
  return date.toLocaleString("en-US", {
    dateStyle: "medium",
    timeStyle: "long",
  });
}

/** The browser and platform, without the token soup nobody reads. */
function shorten(userAgent: string | null): string {
  if (!userAgent) return "—";
  const platform = userAgent.match(/\(([^)]+)\)/)?.[1]?.split(";")[0] ?? "";
  const browser =
    userAgent.match(/(Firefox|Edg|Chrome|Safari)\/[\d.]+/)?.[0]?.replace("Edg", "Edge") ??
    "";
  const summary = [browser, platform].filter(Boolean).join(" · ");
  return summary || userAgent.slice(0, 60);
}
