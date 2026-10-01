/**
 * THE MARK — what a signature actually is, on the wire and in the column.
 *
 * Two forms, both signatures under ESIGN and UETA, which define one as any
 * "sound, symbol, or process attached to or logically associated with a record
 * and executed or adopted with the intent to sign":
 *
 * - **typed** — `typed:Dana Whitfield`. A name the signer adopted. This is what
 *   most e-signature traffic actually is, and it is fully enforceable.
 * - **drawn** — an SVG path. Their hand, from a finger or a mouse.
 *
 * **Drawn marks are stored as SVG paths, not PNG data URLs.** A 400×150 PNG is
 * 15–40 KB of base64 per signature and it renders soft at print resolution; the
 * same stroke as path data is under 2 KB and scales to any size a court exhibit
 * needs. It is also inspectable — a reviewer can see it is a stroke rather than
 * an opaque blob.
 *
 * No React, no I/O: the pad produces these, the server validates them, and the
 * renderer draws them, all from this one definition.
 */

/** Ceiling on stored path data. A signature is a few strokes, not a drawing. */
const MAX_PATH_BYTES = 24_000;
const MAX_NAME_LENGTH = 120;

export type SignatureMark =
  | { kind: "typed"; value: string; name: string }
  | { kind: "drawn"; value: string; paths: string[] };

export class MarkError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MarkError";
  }
}

/** Encodes a typed name as the stored value. */
export function typedMark(name: string): string {
  const trimmed = name.trim();
  if (!trimmed) throw new MarkError("Type your name to sign.");
  if (trimmed.length > MAX_NAME_LENGTH) {
    throw new MarkError("That name is too long to be a signature.");
  }
  return `typed:${trimmed}`;
}

/**
 * Encodes drawn strokes as the stored value.
 *
 * Each stroke is one SVG path in a fixed 600×200 coordinate space, so the
 * renderer never needs to know what size the pad was on the signer's phone.
 */
export function drawnMark(paths: readonly string[]): string {
  const clean = paths.map((p) => p.trim()).filter(Boolean);

  if (clean.length === 0) {
    throw new MarkError("Draw your signature before continuing.");
  }

  // Anything that is not path data has no business reaching an `<svg>`. This is
  // the sanitizer: the value is rendered into a `d` attribute, and letting
  // arbitrary text through there is how a signature field becomes an injection
  // point.
  for (const path of clean) {
    if (!/^[MmLlCcQqZzHhVvSsTt0-9eE ,.\-+]+$/.test(path)) {
      throw new MarkError("That signature could not be read.");
    }
  }

  const value = `drawn:${clean.join(" ")}`;
  if (Buffer.byteLength(value, "utf8") > MAX_PATH_BYTES) {
    throw new MarkError(
      "That signature is too detailed to store. Try signing a little more simply."
    );
  }

  return value;
}

/** Reads a stored value back into something renderable. */
export function parseMark(value: string): SignatureMark {
  if (value.startsWith("typed:")) {
    const name = value.slice("typed:".length);
    return { kind: "typed", value, name };
  }

  if (value.startsWith("drawn:")) {
    const body = value.slice("drawn:".length);
    // Split on the start of each path command rather than on whitespace, since
    // path data is full of spaces.
    const paths = body.split(/(?=M)/).map((p) => p.trim()).filter(Boolean);
    return { kind: "drawn", value, paths };
  }

  // Historical rows and anything hand-inserted. Treated as typed rather than
  // rejected: a signature that fails to render is worse than one that renders
  // plainly, and this is a record we are never allowed to edit.
  return { kind: "typed", value, name: value };
}

/** The coordinate space every drawn mark is normalized into. */
export const MARK_VIEWBOX = { width: 600, height: 200 } as const;
