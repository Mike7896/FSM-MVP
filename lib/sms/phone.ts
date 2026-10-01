/**
 * A phone number as typed, made into the E.164 form a text needs — or null
 * when it can't be. US and Canadian numbers may be typed without the +1.
 *
 * No I/O: the settings form checks a number with this before saving, and the
 * server checks it again with the same rule.
 */
export function toE164(input: string): string | null {
  const digits = input.replace(/[^\d+]/g, "");
  if (/^\+[1-9]\d{7,14}$/.test(digits)) return digits;
  const bare = digits.replace(/\D/g, "");
  if (bare.length === 10) return `+1${bare}`;
  if (bare.length === 11 && bare.startsWith("1")) return `+${bare}`;
  return null;
}

/** "+15551234567" → "(555) 123-4567"; anything else as it is. */
export function formatPhone(e164: string): string {
  const us = e164.match(/^\+1(\d{3})(\d{3})(\d{4})$/);
  return us ? `(${us[1]}) ${us[2]}-${us[3]}` : e164;
}
