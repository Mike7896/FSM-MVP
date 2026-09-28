/**
 * **Account** — the person, and what they pay us with. IA §5.3, wireframe
 * 94 · 56b.
 *
 * One screen, for the same reason Settings is: sign-in and a bill.
 *
 * This is the one wing where money moves from the contractor to us rather than
 * from a homeowner to the contractor, and the posture does not change with the
 * direction — everywhere else the product is the contractor's advocate, and it
 * must not stop being that the moment it starts charging them. So cancel is
 * easy to find, a lapsed card gets a grace period in plain language, and export
 * is offered before the exit rather than behind it.
 *
 * **No destination here is named after a vendor**, and what a *customer* pays
 * the contractor with is not here at all — that is a rail, and rails are
 * connections in the Office.
 */
export default function AccountLayout({
  children,
}: LayoutProps<"/account">) {
  return <div className="mx-auto w-full max-w-3xl">{children}</div>;
}
