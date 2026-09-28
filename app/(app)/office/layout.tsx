import { OfficeNav } from "@/components/office-nav";

/**
 * **The Office** — the business itself. IA §5.3, wireframe 94 · 34 and 56a.
 *
 * Identity, house rules, credentials, and the connections to everything outside
 * the product. This is the one of the three occasional-use destinations that
 * earns a sidebar slot, because a contractor **returns to it to work** — the
 * license they need for a township, the pack their trade runs on, the deposit
 * percentage every quote starts from.
 *
 * Its objects supply data to a Job's documents and are never edited from one. A
 * Preset supplies the five decisions to a Quote, a License stamps a document
 * and authorizes a Permit, a Trade pack supplies templates and taxonomy. That
 * one-directional rule is what keeps this wing from becoming a junk drawer and
 * the Job hub from becoming a settings screen.
 *
 * **A fixed 220px section list beside one panel, and the desk layout is the
 * canonical one.** The Office is desk-primary in practice — nobody tunes
 * exclusions in a truck — so the narrow layout is the compressed version rather
 * than the other way round, and what width buys is *adjacency*: the
 * customer-facing preview sits next to the thing it previews instead of being a
 * screen you navigate to and back from.
 *
 * **Not in the native app.** Document branding, defaults, automations, the pack
 * catalog, connections, and data are excluded from the app entirely — it links
 * out to the browser rather than pretending they are absent. Licenses is the
 * exception, read and attached on site; upgrade is the other, and it lives in
 * the subscription flow.
 */
export default function OfficeLayout({ children }: LayoutProps<"/office">) {
  return (
    <div className="mx-auto grid w-full max-w-(--workspace-max-width) gap-8 lg:grid-cols-[220px_minmax(0,1fr)] lg:gap-12">
      <aside className="lg:sticky lg:top-22 lg:self-start">
        <OfficeNav />
      </aside>
      <div className="@container/office min-w-0">{children}</div>
    </div>
  );
}
