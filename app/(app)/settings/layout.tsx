/**
 * **Settings** — the app, for this person. IA §5.3, wireframe 94 · 56b.
 *
 * **One screen, and its shortness is the point.** Everything that used to make
 * Settings feel like a wing turned out to belong to the business, and once it
 * moved to the Office what remained is six controls. A short screen here is
 * evidence the split is right, not a screen that needs filling — so there is no
 * section rail, because two rows in a rail would dress this up as a wing the
 * design established it is not.
 *
 * **Appearance means the app, here and only here.** The word used to cover how
 * a sent quote looked, which put a decision about the homeowner's screen under
 * a heading about the contractor's. Document branding is the other one, and it
 * is in the Office because it belongs to the business.
 */
export default function SettingsLayout({
  children,
}: LayoutProps<"/settings">) {
  return <div className="mx-auto w-full max-w-3xl">{children}</div>;
}
