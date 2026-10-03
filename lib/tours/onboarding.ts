import type { TourDefinition } from "./types";

/**
 * Onboarding — building the first quote, on a blank quote.
 *
 * **Nothing is filled in for them.** The sentence on the welcome screen names
 * the customer and the job, and every row and every price after that is the
 * contractor's own. This tour shows where each part of a quote lives and has
 * them add their first real line — it does not decorate a demo.
 *
 * Steps that explain move on with Next. Steps that ask for something wait for
 * the editor to report it done, so the lesson and doing it are the same act.
 *
 * Optional steps are about parts that only exist on some screens, and are
 * passed over where their part isn't there: the tool panel and the margin
 * at desk width, the Capture button below it, and the Library once there's
 * an Office for it to belong to.
 */
export const onboardingTour: TourDefinition = {
  id: "onboarding",
  title: "Your first quote",
  summary:
    "Where everything on a quote lives, how to add your own work and prices, and how much of it your customer sees.",
  trigger: { type: "route", pathname: "/welcome/quote" },
  href: "/quotes/new",
  steps: [
    {
      id: "header",
      anchor: "quote.header",
      title: "Check the customer and job",
      body: "The customer and job name come from what you typed. Click either one to change it. Your business name and license number show up here too.",
      advance: { type: "continue" },
    },
    {
      id: "scope",
      anchor: "quote.scope",
      title: "Describe the scope",
      body: "This is the part you fill in: one row for each thing you'll do or supply. Group rows by room or phase if that's how you price.",
      advance: { type: "continue" },
    },
    {
      id: "add-row",
      anchor: "quote.add-row",
      title: "Add your first row",
      body: "Click Add to scope and choose Line item.",
      advance: { type: "action", event: "quote.priced-row-added" },
    },
    {
      id: "price",
      anchor: "quote.row-price",
      title: "Set the quantity and price",
      body: "Describe the row, set the quantity, and type your price per unit. The line total updates by itself.",
      advance: { type: "action", event: "quote.price-entered" },
    },
    {
      id: "customer-detail",
      anchor: "quote.customer-detail",
      title: "Choose what your customer sees",
      body: "One total, each top-level row, or every row. To show or hide the rows inside a single group, use that group's ••• menu.",
      advance: { type: "continue" },
      optional: true,
    },
    {
      id: "tools",
      anchor: "quote.tools",
      title: "Your tools, on the right",
      body: "Money holds pricing, terms and your private margin. Library holds rows you've saved. Capture holds site photos and notes. Your total stays at the top, and the arrow folds the panel away.",
      advance: { type: "continue" },
      optional: true,
    },
    {
      id: "library",
      anchor: "quote.library",
      title: "Save rows to use again",
      body: "On any row, group or assembly, open the ••• menu and choose Save to library. On your next quote, drag it from the Library into Scope, or tap it to add it.",
      advance: { type: "continue" },
      optional: true,
    },
    {
      id: "capture",
      anchor: "quote.capture",
      title: "Keep site details close",
      body: "Photos, notes and measurements from the visit open from here, so you can check them while you write.",
      advance: { type: "continue" },
      optional: true,
    },
    {
      id: "margin",
      anchor: "quote.margin",
      title: "Check your margin",
      body: "Open “Your cost & markup” on a row to compare what it costs you with what you charge. Only you see this. It's never on your customer's copy.",
      advance: { type: "continue" },
      optional: true,
    },
    {
      id: "pricing",
      anchor: "quote.pricing",
      title: "The total",
      body: "Pricing adds up your rows, so you never type a total. To take a deposit, click “Set a deposit and how you get paid”.",
      advance: { type: "continue" },
    },
    {
      id: "terms",
      anchor: "quote.terms",
      title: "Terms and signatures",
      body: "Terms say in plain words what the price covers. Your customer signs to accept, right below.",
      advance: { type: "continue" },
    },
    {
      id: "preview",
      anchor: "quote.preview",
      title: "See what your customer sees",
      body: "When it looks right, click Preview to see the quote exactly as it will go out.",
      advance: { type: "action", event: "quote.previewed" },
    },
  ],
};
