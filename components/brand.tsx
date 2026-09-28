import { cn } from "@/lib/utils";

/**
 * The ServiceClerk marks — Brand Assets sheet 05 and Brand Kit.md.
 *
 * **Artwork, not text.** Each mark reproduces its SVG from the sheet: same
 * viewBox, same pinned `textLength`, same tracking. Never rebuild the name in
 * CSS type — that is the kit's constraint, and it is why these are the only
 * place the name is drawn.
 *
 * **Inline, not `<img>`.** The wordmark is set in live Archivo, as the sheet
 * sets it, and an SVG loaded as an image can't see the page's fonts — it
 * would draw in a substitute face. Inlined, it uses the Archivo next/font
 * already loaded. The icon is drawn as outlines instead: it is also the
 * favicon (`app/icon.svg`, same path), and a browser tab can't load a font.
 *
 * Full colour on a light ground, the reversed white version on a dark one —
 * the sheet's two screen versions, and the only change between them.
 *
 * Sizes are inline styles on purpose: menus and buttons size every `svg`
 * inside them to an icon, and a mark must not be one.
 */

/**
 * The SC monogram, outlined: Archivo 700 at −0.03em, 156px in a 256 square,
 * exactly where the sheet's `<text x="19.88" y="182.5">` puts it.
 */
const MONOGRAM =
  "M73.37 184.37Q64.02 184.37 55.59 182.5Q47.17 180.63 40.7 176.49Q34.23 172.36 30.56 166.04Q26.9 159.72 26.9 150.68Q26.9 149.9 26.9 149.04Q26.9 148.18 27.05 147.71L50.14 147.71Q49.98 148.18 49.98 148.96Q49.98 149.74 49.98 150.36Q49.98 155.36 52.71 158.79Q55.44 162.22 60.74 163.94Q66.04 165.65 73.06 165.65Q77.58 165.65 81.09 165.11Q84.6 164.56 87.33 163.55Q90.06 162.53 91.85 161.13Q93.65 159.72 94.51 157.85Q95.36 155.98 95.36 153.64Q95.36 149.43 92.63 146.78Q89.91 144.12 85.15 142.25Q80.39 140.38 74.47 138.82Q68.54 137.26 62.3 135.62Q56.06 133.98 50.14 131.57Q44.21 129.15 39.53 125.72Q34.85 122.28 32.04 116.98Q29.24 111.68 29.24 104.19Q29.24 96.23 32.59 90.46Q35.94 84.69 42.03 80.94Q48.11 77.2 56.06 75.41Q64.02 73.61 73.37 73.61Q82.11 73.61 89.91 75.41Q97.7 77.2 103.63 81.1Q109.56 85 112.91 90.93Q116.26 96.86 116.26 104.97L116.26 106.84L93.65 106.84L93.65 105.59Q93.65 101.38 91.15 98.42Q88.66 95.45 84.13 93.74Q79.61 92.02 73.53 92.02Q66.98 92.02 62.38 93.27Q57.78 94.52 55.36 96.93Q52.94 99.35 52.94 102.63Q52.94 106.37 55.67 108.79Q58.4 111.21 63.16 113Q67.92 114.8 73.84 116.2Q79.77 117.6 86.01 119.32Q92.24 121.04 98.17 123.38Q104.1 125.72 108.78 129.23Q113.45 132.74 116.26 137.88Q119.07 143.03 119.07 150.21Q119.07 162.53 113.14 170.02Q107.22 177.51 96.92 180.94Q86.63 184.37 73.37 184.37ZM180.82 184.37Q164.13 184.37 152.28 178.52Q140.43 172.67 134.27 160.35Q128.11 148.02 128.11 128.99Q128.11 100.91 141.91 87.26Q155.71 73.61 180.82 73.61Q194.55 73.61 205.46 78.29Q216.38 82.97 222.7 92.33Q229.01 101.69 229.01 115.89L205.62 115.89Q205.62 108.4 202.58 103.25Q199.54 98.1 194 95.37Q188.46 92.64 181.13 92.64Q171.15 92.64 164.68 96.54Q158.21 100.44 155.17 108.01Q152.13 115.58 152.13 126.5L152.13 131.33Q152.13 142.56 155.25 150.13Q158.36 157.7 164.68 161.52Q171 165.34 180.98 165.34Q188.78 165.34 194.55 162.69Q200.32 160.04 203.44 154.89Q206.56 149.74 206.56 142.25L229.01 142.25Q229.01 156.45 222.85 165.81Q216.69 175.17 205.78 179.77Q194.86 184.37 180.82 184.37Z";

/** "Service" light in neutral 600, "Clerk" bold in text — set solid, no space. */
function WordmarkText({ x = 0, y }: { x?: number; y: number }) {
  return (
    <text
      x={x}
      y={y}
      textLength={563.9}
      lengthAdjust="spacingAndGlyphs"
      style={{
        fontFamily: "var(--font-archivo), sans-serif",
        fontSize: 100,
        fontWeight: 400,
        letterSpacing: "-2.2px",
      }}
    >
      <tspan className="fill-(--brand-neutral-600) dark:fill-white/55">
        Service
      </tspan>
      <tspan
        style={{ fontWeight: 700 }}
        className="fill-(--brand-ink) dark:fill-white"
      >
        Clerk
      </tspan>
    </text>
  );
}

/**
 * The wordmark. `size` is the type size the sheet specifies it in: 17 in the
 * app nav (96px wide), 13 at the floor (73px wide) — never smaller.
 */
export function Wordmark({
  size = 17,
  className,
}: {
  size?: number;
  className?: string;
}) {
  return (
    <svg
      viewBox="0 0 563.9 73"
      role="img"
      aria-label="ServiceClerk"
      className={cn("block shrink-0 overflow-visible", className)}
      style={{ height: size * 0.73, width: "auto" }}
    >
      <WordmarkText y={73} />
    </svg>
  );
}

/**
 * The SC icon, `size` px square. Amber is allowed here and nowhere else in the
 * mark, and it carries its own ground, so it stays in colour on dark too.
 */
export function BrandIcon({
  size = 32,
  className,
}: {
  size?: number;
  className?: string;
}) {
  return (
    <svg
      viewBox="0 0 256 256"
      role="img"
      aria-label="ServiceClerk"
      className={cn("block shrink-0", className)}
      style={{ width: size, height: size }}
    >
      <rect width="256" height="256" className="fill-(--brand-amber)" />
      <path d={MONOGRAM} className="fill-(--brand-neutral-800)" />
    </svg>
  );
}

/**
 * Icon plus wordmark in the fixed arrangement: the tile is one em of the
 * wordmark, 0.28em gap, the cap block centred on the tile. `size` is that em,
 * which is also the lockup's height. The one place amber and the name appear
 * together — kept for the homeowner's trust surfaces.
 */
export function Lockup({
  size = 30,
  className,
}: {
  size?: number;
  className?: string;
}) {
  return (
    <svg
      viewBox="0 0 691.9 100"
      role="img"
      aria-label="ServiceClerk"
      className={cn("block shrink-0 overflow-visible", className)}
      style={{ height: size, width: "auto" }}
    >
      <g transform="scale(0.390625)">
        <rect
          width="256"
          height="256"
          className="fill-(--brand-amber) dark:fill-white"
        />
        <path
          d={MONOGRAM}
          className="fill-(--brand-neutral-800) dark:fill-black"
        />
      </g>
      <WordmarkText x={128} y={85} />
    </svg>
  );
}
