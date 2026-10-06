/**
 * Document branding — the looks a business can send, wireframe 94 · 34c.
 *
 * **Presets, not a design tool.** No fonts, no colours, no layout editor. Three
 * looks that all read cleanly on a phone in a driveway, and that is the whole
 * choice. Said out loud here because this is the file where a font picker would
 * be easiest to add.
 *
 * **Each preset carries a reason, including its cost.** A preset list without
 * trade-offs is a taste quiz — "Bold header looks established; it costs a
 * little vertical room on her screen" is what lets a contractor pick on
 * something other than which word sounds nicest.
 *
 * The names describe what changes at the top of the document, because that is
 * the only thing that does change. *Classic* and *Bold*, the previous names,
 * described a mood.
 *
 * Kept out of `lib/schemas` so a Server Component can read the labels without
 * pulling a validation dependency, and shared by the branding form, the
 * business-identity page and the share surface so the three cannot disagree
 * about what a preset is called.
 */
export const DOCUMENT_PRESETS = [
  {
    id: "plain",
    name: "Plain",
    note: "Your name in type, nothing else.",
    reason: "Reads fastest on a phone and never looks dated.",
  },
  {
    id: "with_logo",
    name: "With logo",
    note: "Your mark beside your name at the top.",
    reason: "Needs a logo that reads at 40px.",
  },
  {
    id: "bold_header",
    name: "Bold header",
    note: "A solid band across the top.",
    reason:
      "Looks established; costs a little vertical room on her screen.",
  },
] as const;

/**
 * The logo and the band are two separate choices, and a business can have
 * both. Plain is neither. The four combinations are stored as one value so the
 * column and everything that reads it stay a single preset.
 */
export const DOCUMENT_PRESET_IDS = [
  "plain",
  "with_logo",
  "bold_header",
  "with_logo_bold_header",
] as const;

export type DocumentPreset = (typeof DOCUMENT_PRESET_IDS)[number];

/** What a document's header carries: the logo beside the name, the band behind it. */
export type DocumentLook = { logo: boolean; bold: boolean };

/**
 * A stored preset falls back rather than rendering nothing.
 *
 * `classic` and `bold` are the names this setting shipped with before the
 * rename; a row written under either still has to render something, and the
 * migration maps them, so this is the belt to that migration's braces.
 */
export function normalizePreset(value: string | null | undefined): DocumentPreset {
  if (value === "classic") return "with_logo";
  if (value === "bold") return "bold_header";
  return DOCUMENT_PRESET_IDS.includes(value as DocumentPreset)
    ? (value as DocumentPreset)
    : "plain";
}

export function lookOf(value: string | null | undefined): DocumentLook {
  const preset = normalizePreset(value);
  return {
    logo: preset === "with_logo" || preset === "with_logo_bold_header",
    bold: preset === "bold_header" || preset === "with_logo_bold_header",
  };
}

export function presetOf(look: DocumentLook): DocumentPreset {
  if (look.logo && look.bold) return "with_logo_bold_header";
  if (look.logo) return "with_logo";
  if (look.bold) return "bold_header";
  return "plain";
}

/** What to call the current preset where it is shown but not chosen. */
export function presetLabel(value: string | null | undefined): string {
  const { logo, bold } = lookOf(value);
  if (logo && bold) return "With logo, bold header";
  if (logo) return "With logo";
  if (bold) return "Bold header";
  return "Plain";
}
