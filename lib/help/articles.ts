/**
 * The help articles and the FAQ.
 *
 * **Written against the app as it is**, not as it's planned: every step names
 * a screen that exists and a button that's there. Where something isn't built
 * yet, an answer says so and points at "Suggest a feature" rather than
 * implying it's somewhere they haven't found.
 *
 * Plain data, no server imports, so the in-app help pages and the public
 * support page read the same words.
 */

export type HelpBlock =
  | { type: "p"; text: string }
  | { type: "h"; text: string }
  | { type: "steps"; items: string[] }
  | { type: "list"; items: string[] }
  | { type: "tip"; text: string };

export type HelpArticle = {
  slug: string;
  title: string;
  /** One line: what reading it gets you. */
  summary: string;
  category: HelpCategory;
  body: HelpBlock[];
  /** Where in the app this happens, for the "Take me there" button. */
  where?: { label: string; href: string };
  related?: string[];
};

export type HelpCategory =
  | "Getting started"
  | "Quotes and customers"
  | "Getting paid"
  | "Running the job"
  | "Your business and account";

export const HELP_CATEGORIES: HelpCategory[] = [
  "Getting started",
  "Quotes and customers",
  "Getting paid",
  "Running the job",
  "Your business and account",
];

export const HELP_ARTICLES: HelpArticle[] = [
  /* ── Getting started ─────────────────────────────────────────────────── */
  {
    slug: "first-quote",
    title: "Send your first quote",
    summary: "From a blank page to a link in your customer's inbox.",
    category: "Getting started",
    where: { label: "Start a quote", href: "/quotes/new" },
    related: ["office-setup", "customer-approves", "get-paid"],
    body: [
      {
        type: "p",
        text: "A quote here is the whole offer: who it's for, the work written out row by row, the price, how you get paid, and space for your customer to sign. You write it once, and your customer reads it on a link — no app, no account, no PDF attachment.",
      },
      { type: "h", text: "Write it" },
      {
        type: "steps",
        items: [
          "Press New quote at the top of any page.",
          "Under Header, type your customer's name and a short title for the work.",
          "Under Scope, describe the work in plain words, then use Add to scope for each row — labor, materials, permits, allowances. Each row can carry a price, or be a note or an exclusion.",
          "Check the Pricing panel on the right. It totals itself from the scope; you never type a total.",
          "Under Terms, open How you get paid to choose a deposit, payments as phases finish, or one invoice at the end.",
          "Leave Signature lines on if you want your customer to sign to accept.",
        ],
      },
      { type: "h", text: "Send it" },
      {
        type: "steps",
        items: [
          "Press Preview it (Preview & send on a quote you've saved) to read it the way your customer will.",
          "Send it by email from there — check the message first — or copy the link and text it yourself.",
          "You're told when they open it, and again when they approve it.",
        ],
      },
      {
        type: "tip",
        text: "Walked the job first? Photos, notes and measurements you capture on the visit sit beside the quote while you write it, under From the visit.",
      },
    ],
  },
  {
    slug: "office-setup",
    title: "Set up your Office",
    summary: "Your business name, logo, license and defaults — the things every document carries.",
    category: "Getting started",
    where: { label: "Open the Office", href: "/office" },
    related: ["first-quote", "licenses"],
    body: [
      {
        type: "p",
        text: "The Office is your business: who you are, how your documents look, and where every new quote starts. You set it once and it rides along on every quote, contract and invoice.",
      },
      {
        type: "list",
        items: [
          "Business identity — name, address, phone, email and logo. It's the letterhead your customer reads first.",
          "Document branding — how quotes, contracts and invoices look on paper and on the link.",
          "Defaults — where every new quote starts: deposit, markup, tax rate, labor rate, how long a quote is good for, and your standard exclusions, assumptions and terms.",
          "Licenses — each license you hold, where it's good, and when it renews.",
          "Connections — card payments and, as they arrive, accounting and bank connections.",
          "Data — bring customers in from a spreadsheet, and take everything out.",
        ],
      },
      {
        type: "tip",
        text: "Changing the Office changes new documents. A quote you've already sent keeps the details it was sent with.",
      },
    ],
  },
  {
    slug: "demo-quote",
    title: "What the demo quote is for",
    summary: "A practice quote you can open, send to yourself and poke at — it never counts.",
    category: "Getting started",
    related: ["first-quote"],
    body: [
      {
        type: "p",
        text: "When you sign up you can start from a demo quote instead of a blank page. It's a real quote on a real job, marked Demo, so you can see how everything fits before you put your own work in.",
      },
      {
        type: "list",
        items: [
          "It's marked Demo everywhere it appears.",
          "It's left out of your dashboard, your money totals and your exports — practice work never mixes with real work.",
          "Your customer can't approve it: on the link, approving is switched off.",
        ],
      },
    ],
  },

  /* ── Quotes and customers ────────────────────────────────────────────── */
  {
    slug: "customer-approves",
    title: "How your customer approves and signs",
    summary: "What your customer sees on the link, and what happens when they say yes.",
    category: "Quotes and customers",
    related: ["first-quote", "change-orders", "info-requests"],
    body: [
      {
        type: "p",
        text: "Your customer opens the link on their phone or computer. There's nothing to install and no account to make. They see your letterhead, the work, the price and the terms, laid out like a paper quote.",
      },
      { type: "h", text: "When they approve" },
      {
        type: "steps",
        items: [
          "With signature lines on, they sign right on the quote to accept it. With them off, they press the approve button.",
          "A contract is made from the quote they accepted. When they signed the quote, the contract is signed by both of you — your saved signature and theirs.",
          "You're told, and the plan for getting paid you put on the quote carries over to the job.",
        ],
      },
      {
        type: "tip",
        text: "A quote can have a valid-until date. After it passes, the link says the price has lapsed and points them back to you rather than letting them approve an old number.",
      },
    ],
  },
  {
    slug: "info-requests",
    title: "Asking a customer for information",
    summary: "Get a panel size, a photo or a decision from your customer without a phone call.",
    category: "Quotes and customers",
    related: ["customer-approves"],
    body: [
      {
        type: "p",
        text: "Sometimes you can't finish a quote without something only the customer knows — a photo of the panel, which fixture they picked, when the drywall is going up. Ask for info sends them a short question on a link, and their answer comes back to the quote.",
      },
      {
        type: "steps",
        items: [
          "Open the quote and press Ask for info at the top.",
          "Write the question the way you'd say it.",
          "Send it. Their answer comes back to the quote.",
        ],
      },
    ],
  },
  {
    slug: "change-orders",
    title: "Changing the work after it's signed",
    summary: "Change orders: add or take out work on a signed job, with the customer's okay.",
    category: "Quotes and customers",
    related: ["customer-approves", "get-paid"],
    body: [
      {
        type: "p",
        text: "Once a contract is signed, the scope doesn't change by conversation. A change order writes down exactly what's being added or taken out and what it does to the price, and your customer approves it the same way they approved the quote.",
      },
      {
        type: "steps",
        items: [
          "Open the job and choose Change orders and customer requests.",
          "Start a change order, write the change row by row, and price it.",
          "Send it. Your customer approves it on the link, and the job's total moves with it.",
        ],
      },
      {
        type: "p",
        text: "It works the other way too: your customer can ask for a change from their contract link. Their request lands on the same page, and you answer it with a change order — or a reply saying why not.",
      },
    ],
  },

  /* ── Getting paid ────────────────────────────────────────────────────── */
  {
    slug: "get-paid",
    title: "Deposits, draws and the final invoice",
    summary: "Plan how a job gets paid, then bill each part when it's due.",
    category: "Getting paid",
    related: ["card-payments", "change-orders"],
    body: [
      {
        type: "p",
        text: "Every job has a plan for how the money comes in. You set it on the quote under How you get paid, and the job keeps it: a deposit up front, payments as phases finish (draws), and the final balance — or just one invoice at the end.",
      },
      { type: "h", text: "Billing as you go" },
      {
        type: "steps",
        items: [
          "Open the job. The money, in order shows each payment and where it stands.",
          "When a phase is done, mark it complete. Add a short write-up and photos — they go out with the bill, so the ask never lands out of nowhere.",
          "Send the invoice. You can also save a phase as done and bill it later.",
        ],
      },
      {
        type: "tip",
        text: "No quote? You can still bill a job — open the job and choose to bill it with no quote.",
      },
    ],
  },
  {
    slug: "card-payments",
    title: "Taking card payments",
    summary: "Let customers pay an invoice by card, straight from the link.",
    category: "Getting paid",
    where: { label: "Open Connections", href: "/office/connections" },
    related: ["get-paid"],
    body: [
      {
        type: "p",
        text: "Card payments run through Stripe. Once you connect it, every invoice link gets a pay button with the amount on it, and the money goes to your own Stripe account.",
      },
      {
        type: "steps",
        items: [
          "In the Office, open Connections.",
          "Choose Card payments and follow Stripe's steps to connect or create your account.",
          "Once it's connected, invoice links show a pay button.",
        ],
      },
      {
        type: "p",
        text: "Card details go straight to Stripe — they never touch our servers. A payment that clears shows on the job's money, and you're told.",
      },
    ],
  },

  /* ── Running the job ─────────────────────────────────────────────────── */
  {
    slug: "job-page",
    title: "The job page",
    summary: "Everything that happens around one piece of work, on one page.",
    category: "Running the job",
    where: { label: "Open Jobs", href: "/jobs" },
    related: ["tasks", "permits", "get-paid"],
    body: [
      {
        type: "p",
        text: "A job is one piece of work at one address. Its page holds the whole story: what it's worth and what's been collected, the paperwork in the order it happened, what you captured on the visit, what you've spent, its permits, and what's still to do.",
      },
      {
        type: "list",
        items: [
          "The money, in order — each payment and where it stands.",
          "The paperwork, in order — the quote, the contract, change orders and invoices.",
          "From the visit — photos, notes and measurements.",
          "What you've spent — receipts against the job.",
          "Tasks — what's still to do, and who's doing it.",
          "Permits — each permit and its inspections.",
        ],
      },
    ],
  },
  {
    slug: "permits",
    title: "Permits and inspections",
    summary: "Track each permit on a job, and the inspections it needs.",
    category: "Running the job",
    related: ["schedule", "licenses"],
    body: [
      {
        type: "p",
        text: "A permit belongs to one job. Add it from the job page with its jurisdiction and number, then add its inspections — rough-in, final, and any others — with their dates and results.",
      },
      {
        type: "list",
        items: [
          "An inspection's date shows on the schedule automatically. Change it on the permit, and it moves there too.",
          "When a result is recorded, the people who need to know are told.",
          "Permits that sit too long without a passed inspection can lapse, so an old open permit is worth a look.",
        ],
      },
    ],
  },
  {
    slug: "schedule",
    title: "The schedule",
    summary: "Book visits, see who's where, and move things with a drag.",
    category: "Running the job",
    where: { label: "Open the schedule", href: "/schedule" },
    related: ["tasks", "permits"],
    body: [
      {
        type: "p",
        text: "The schedule works like a wall calendar with a color per person. Every block is a visit to a job, an estimate visit, time off, or something else like a supply run.",
      },
      {
        type: "steps",
        items: [
          "Drag across empty time to book a visit, or press Book a visit.",
          "Pick the job and who's going. The title fills itself in from the customer and the job.",
          "Drag a block to move it, or its bottom edge to make it longer. Click it to change it, mark it done or remove it.",
        ],
      },
      {
        type: "list",
        items: [
          "Book someone twice, or over their time off, and it's allowed — but you're told.",
          "Anyone you put on a visit is told they're booked.",
          "Inspections and task due dates show along the top of each day.",
          "Keys: T for today, J and K to move, D, W and M for day, week and month, C to book.",
        ],
      },
    ],
  },
  {
    slug: "tasks",
    title: "Tasks",
    summary: "Keep track of what needs doing — on a job, or for the business.",
    category: "Running the job",
    where: { label: "Open Tasks", href: "/tasks" },
    related: ["schedule", "job-page"],
    body: [
      {
        type: "p",
        text: "A task is something somebody has to do: order the panel, call the inspector, go back for the trim. Put it on a job, give it to someone, and give it a day.",
      },
      {
        type: "list",
        items: [
          "List shows every task in groups — by status, by job, or by person. Grouped by job, you see how far along each job is.",
          "Board shows tasks as cards in columns: Backlog, To do, In progress, Done. Drag a card to move it along.",
          "Click a task's circle, priority, date or person to change it without opening it.",
          "On a job's page, type a task and press Enter to add it to that job.",
          "Book time opens the schedule with a visit filled in from the task.",
          "Whoever you give a task to is told.",
        ],
      },
    ],
  },

  /* ── Your business and account ───────────────────────────────────────── */
  {
    slug: "licenses",
    title: "Licenses",
    summary: "Keep each license, where it's good, and when it renews.",
    category: "Your business and account",
    where: { label: "Open Licenses", href: "/office/licenses" },
    related: ["office-setup", "permits"],
    body: [
      {
        type: "p",
        text: "Add each license you hold with its jurisdiction, number and expiry date. Give it a name if you hold several, so you can tell them apart at a glance.",
      },
      {
        type: "list",
        items: [
          "Your license number goes on your documents.",
          "You're reminded before a license expires.",
        ],
      },
    ],
  },
  {
    slug: "notifications",
    title: "Choosing what you're told about",
    summary: "Pick what reaches you, and whether by email, text or in the app.",
    category: "Your business and account",
    where: { label: "Open notification settings", href: "/settings#notifications" },
    related: ["schedule", "tasks"],
    body: [
      {
        type: "p",
        text: "Everything lands in the app — the bell at the top, and a pop-up while you're using it. For each kind of news you can also choose email and text.",
      },
      {
        type: "list",
        items: [
          "Email can come as it happens, or collected into one summary a day.",
          "Texts start off; add your phone number to turn them on.",
          "Quiet hours hold texts overnight.",
        ],
      },
    ],
  },
  {
    slug: "your-data",
    title: "Your data: bringing it in and taking it out",
    summary: "Import customers from a spreadsheet, and export everything whenever you like.",
    category: "Your business and account",
    where: { label: "Open Data", href: "/office/data" },
    related: ["office-setup"],
    body: [
      {
        type: "p",
        text: "Your records are yours. In the Office under Data, you can download everything the app holds about your business as spreadsheet files (CSV), at any time, on any plan.",
      },
      {
        type: "p",
        text: "You can bring customers in from a spreadsheet too, so you don't retype a list you already have.",
      },
    ],
  },
  {
    slug: "plan-billing",
    title: "Your plan and billing",
    summary: "See what you're on, change it, or cancel.",
    category: "Your business and account",
    where: { label: "Open Billing", href: "/account/billing" },
    related: ["your-data"],
    body: [
      {
        type: "p",
        text: "Your plan and payment details live under Account, in Billing. It shows what you're on and what you pay each month.",
      },
      {
        type: "list",
        items: [
          "Change plan to move up or down.",
          "Cancel from the same page — no call, no form to email.",
          "Before you go, you can export everything from Office → Data.",
        ],
      },
    ],
  },
];

export type HelpFaq = { question: string; answer: string; article?: string };

export const HELP_FAQS: HelpFaq[] = [
  {
    question: "Does my customer need an account or an app?",
    answer:
      "No. They open a link in their email or a text, on any phone or computer. They can read the quote, sign it, ask for a change and pay — without making an account.",
    article: "customer-approves",
  },
  {
    question: "My customer says they never got the email. What now?",
    answer:
      "Ask them to check spam and promotions first. You can always copy the quote's link from the send screen and text it to them — the link is the quote, however it reaches them.",
    article: "first-quote",
  },
  {
    question: "Can I change a quote after I've sent it?",
    answer:
      "Yes, until it's approved. Once your customer has approved it and there's a contract, the work changes through a change order instead, so both of you agree to exactly what changed.",
    article: "change-orders",
  },
  {
    question: "How do customers pay me?",
    answer:
      "By card, from the invoice link, once you've connected card payments in Office → Connections. The money goes to your own Stripe account. You can still take checks and cash as you always have.",
    article: "card-payments",
  },
  {
    question: "Is card information safe?",
    answer:
      "Card details go straight from your customer's browser to Stripe. They never pass through or get stored on our servers.",
    article: "card-payments",
  },
  {
    question: "What's the demo quote, and will it mess up my numbers?",
    answer:
      "It's a practice quote to look around with. It's marked Demo and left out of your dashboard, totals and exports, and customers can't approve it.",
    article: "demo-quote",
  },
  {
    question: "Can I add the people who work with me?",
    answer:
      "Not from the app yet. If your crew needs their own sign-in, tell us with Suggest a feature — it helps us decide what comes next.",
  },
  {
    question: "Is there a phone app?",
    answer:
      "The app works in your phone's browser, laid out for the small screen. There isn't a separate app to install from the store yet.",
  },
  {
    question: "Can I get my data out?",
    answer:
      "Yes, all of it, any time, on any plan — Office → Data downloads everything as spreadsheets.",
    article: "your-data",
  },
  {
    question: "How do I cancel?",
    answer:
      "Account → Billing → Cancel. No call and no email needed. Export your data first if you want a copy.",
    article: "plan-billing",
  },
  {
    question: "Why can't my customer approve the quote?",
    answer:
      "Either its valid-until date has passed — the link then points them back to you — or it's the demo quote, which can't be approved. Send a fresh quote or change the date.",
    article: "customer-approves",
  },
  {
    question: "Who sees my jobs and customers?",
    answer:
      "Only the people in your business. Your customers see only what you send them, on their own link.",
  },
  {
    question: "I found something broken. What helps you fix it fastest?",
    answer:
      "Use Report a problem from the page where it happened, and say what you did and what you expected. The page comes with the report, and a short recording of what you just did can come with it — with the text on screen blanked out.",
  },
];

export function helpArticle(slug: string) {
  return HELP_ARTICLES.find((article) => article.slug === slug) ?? null;
}

/** Everything an article says, as one line of text, for the search box. */
export function searchableText(article: HelpArticle) {
  return [
    article.title,
    article.summary,
    ...article.body.flatMap((block) => ("items" in block ? block.items : [block.text])),
  ]
    .join(" ")
    .toLowerCase();
}
