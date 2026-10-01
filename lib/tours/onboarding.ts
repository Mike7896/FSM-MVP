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
 */
export const onboardingTour: TourDefinition = {
  id: "onboarding",
  title: "Your first quote",
  summary:
    "Where everything on a quote lives, and how to add your own work and prices.",
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
      id: "capture",
      anchor: "quote.capture",
      title: "Keep site details close",
      body: "Add site photos, notes, and measurements here to refer to while you write. Use the arrow to collapse this panel.",
      advance: { type: "continue" },
      // Optional, so it is passed over on a phone, where capture is the job's
      // own screen rather than a column beside the document.
      optional: true,
    },
    {
      id: "scope",
      anchor: "quote.scope",
      title: "Describe the scope",
      body: "This is the part you fill in: one row for each thing you'll do or supply. Your customer reads every row.",
      advance: { type: "continue" },
    },
    {
      id: "add-row",
      anchor: "quote.add-row",
      title: "Add your first row",
      body: "Click Add to scope and choose a line with a price.",
      advance: { type: "action", event: "quote.priced-row-added" },
    },
    {
      id: "price",
      anchor: "quote.row-price",
      title: "Set the quantity and price",
      body: "Describe the row, set the quantity, and type your price per unit. The line total updates automatically.",
      advance: { type: "action", event: "quote.price-entered" },
    },
    {
      id: "margin",
      anchor: "quote.margin",
      title: "Check your margin",
      body: "Click “Add your cost” on a row and to compare your cost with your selling price. It never appears on your customer's copy.",
      advance: { type: "continue" },
      optional: true,
    },
    {
      id: "pricing",
      anchor: "quote.pricing",
      title: "The total",
      body: "Pricing adds up your rows, so you never type a total. Click “How you get paid” under the total to set a deposit, if you take one.",
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
