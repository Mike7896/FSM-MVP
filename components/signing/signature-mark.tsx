import { parseMark, MARK_VIEWBOX } from "@/lib/signing/mark";
import { cn } from "@/lib/utils";

/**
 * A stored signature, rendered.
 *
 * Server-safe — no state, no effects — so it appears on the contract page, in
 * the certificate, and in whatever the dispute packet becomes, from one
 * definition. A signature that renders three slightly different ways in three
 * places is three things to argue about.
 *
 * The two kinds get genuinely different treatment rather than one being faked
 * as the other. A typed mark is set in a script face because that is how a
 * typed signature is conventionally shown and the convention carries meaning;
 * it is never redrawn as strokes, because pretending a typed name was
 * handwritten is the one thing that would make this evidence worse.
 */
export function SignatureMark({
  value,
  className,
}: {
  value: string;
  className?: string;
}) {
  const mark = parseMark(value);

  if (mark.kind === "drawn") {
    return (
      <svg
        viewBox={`0 0 ${MARK_VIEWBOX.width} ${MARK_VIEWBOX.height}`}
        className={cn("h-16 w-auto", className)}
        role="img"
        aria-label="Signature"
      >
        {mark.paths.map((d, index) => (
          <path
            key={index}
            d={d}
            fill="none"
            stroke="currentColor"
            strokeWidth="3"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        ))}
      </svg>
    );
  }

  return (
    <span
      className={cn("text-3xl leading-tight", className)}
      // A script stack rather than a webfont: this has to render in a printed
      // PDF and in an emailed copy, where a font that failed to load would
      // leave a signature looking like body text.
      style={{ fontFamily: '"Segoe Script", "Brush Script MT", "Snell Roundhand", cursive' }}
    >
      {mark.name}
    </span>
  );
}
