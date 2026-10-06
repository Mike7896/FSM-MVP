import Link from "next/link";
import { ArrowRight, Check, CalendarDays, ListChecks, Users } from "lucide-react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import styles from "./product-story.module.css";

const stages = [
  {
    id: "quote", label: "Quote", title: "Put a clear scope in their hands.",
    body: "Break the work into line items, set your prices, and send a homeowner link they can open without creating an account.",
    takeaway: "One place to review the work and the number.", document: "Quote", status: "Ready to send",
    rows: [["Recessed lighting · 12 × $185", "$2,220"], ["Dedicated circuits · 6 × $325", "$1,950"], ["Panel work, wiring & labor", "$4,230"]],
    totalLabel: "Quoted total", total: "$8,400", note: "Your scope and prices. Prepared for the Morgan residence.",
  },
  {
    id: "contract", label: "Contract & deposit", title: "Agree on the work. Set the payment terms.",
    body: "Generate the contract from your quote, collect a signature, and request a percentage-based deposit before the job gets underway.",
    takeaway: "The agreement and the deposit stay with the job.", document: "Contract & deposit", status: "Signed",
    rows: [["Agreed contract", "$8,400"], ["Deposit · 50%", "$4,200"], ["Remaining contract amount", "$4,200"]],
    totalLabel: "Deposit requested", total: "$4,200", note: "Request payment through Stripe, or record a payment received elsewhere.",
  },
  {
    id: "changes", label: "Change order", title: "An extra request deserves a clear agreement.",
    body: "When the homeowner adds work, put the scope and price in a change order. Keep the approval and updated job value together.",
    takeaway: "Extra work gets its own record.", document: "Change order #1", status: "Approved",
    rows: [["Original contract", "$8,400"], ["Add under-cabinet lighting", "+$600"], ["Approved change", "$600"]],
    totalLabel: "Updated job value", total: "$9,000", note: "The added scope stays visible alongside the original agreement.",
  },
  {
    id: "billing", label: "Progress billing", title: "Bill for the next phase. Know what remains.",
    body: "Invoice as the job moves forward, apply the deposit, and keep track of payments and the balance through the final invoice.",
    takeaway: "A longer job can have a clear payment plan.", document: "Job payment record", status: "In progress",
    rows: [["Updated job value", "$9,000"], ["Deposit received", "−$4,200"], ["Rough-in invoice paid", "−$2,520"]],
    totalLabel: "Remaining to collect", total: "$2,280", note: "Illustrative amounts exclude tax and payment processing fees.",
  },
] as const;

/** Illustrative workflow, not a live account or a screenshot of the workspace. */
export function ProductStory() {
  return (
    <section id="product-tour" className={styles.section} aria-labelledby="product-tour-title">
      <div className={styles.heading}>
        <h2 id="product-tour-title">Follow one job.<br />See how it all connects.</h2>
        <p>A kitchen renovation, a new request, and a few payments along the way. Explore this sample job from quote to balance.</p>
      </div>
      <Tabs defaultValue="quote" className={styles.tour}>
        <TabsList aria-label="Sample job stages" className={styles.tabs}>
          {stages.map((stage, index) => <TabsTrigger className={styles.tab} key={stage.id} value={stage.id}><span aria-hidden="true">{index + 1}</span>{stage.label}</TabsTrigger>)}
        </TabsList>
        {stages.map(stage => (
          <TabsContent key={stage.id} value={stage.id} className={styles.panel}>
            <div className={styles.explanation}>
              <h3>{stage.title}</h3><p>{stage.body}</p>
              <p className={styles.takeaway}><Check size={18} aria-hidden="true" />{stage.takeaway}</p>
              <Link href="/signup" className={styles.link}>Try it with your own job <ArrowRight size={17} aria-hidden="true" /></Link>
            </div>
            <figure className={styles.document}>
              <figcaption>Illustrative example · Kitchen renovation</figcaption>
              <div className={styles.documentHeading}><h4>{stage.document}</h4><span>{stage.status}</span></div>
              <p className={styles.customer}>Morgan residence</p>
              <dl>{stage.rows.map(([label, amount]) => <div key={label}><dt>{label}</dt><dd>{amount}</dd></div>)}</dl>
              <div className={styles.total}><span>{stage.totalLabel}</span><strong>{stage.total}</strong></div>
              <p className={styles.note}>{stage.note}</p>
            </figure>
          </TabsContent>
        ))}
      </Tabs>
      <div className={styles.operations}>
        <div><h3>The details between invoices matter, too.</h3><p>Keep the day-to-day work close to the job.</p></div>
        <ul>
          <li><Users aria-hidden="true" /><span><strong>Customers</strong>Keep contact details and job history together.</span></li>
          <li><CalendarDays aria-hidden="true" /><span><strong>Schedule</strong>Plan visits and see what’s coming up.</span></li>
          <li><ListChecks aria-hidden="true" /><span><strong>Tasks</strong>Keep the next steps out of your head.</span></li>
        </ul>
      </div>
    </section>
  );
}

export function MarketingQuestions() {
  const questions = [
    ["What can I do for free?", "Activate three new jobs each month and take those jobs through quotes, contracts, change orders, invoices, and payment collection. Continuing an activated job does not use another monthly slot. No credit card is needed to start."],
    ["Do I need to install an app?", "ServiceClerk runs in your web browser. You can open it on your computer, tablet, or phone with an internet connection. Native mobile and desktop apps are not available yet."],
    ["Does my customer need an account?", "No. Send a homeowner link so they can review the document, approve or sign where required, and pay an invoice when online payments are enabled."],
    ["Can I use my own prices and branding?", "Set your own prices and scope on every plan. Starter and Pro add reusable saved items. Your business details appear on documents; Pro adds your logo. Free documents include a ServiceClerk footer."],
    ["How do I receive payments?", "Connect your Stripe account to accept online payments. Available methods depend on your account’s approval and capabilities, and processing fees apply. You can also record payments received by cash, check, or other methods."],
  ];
  return <section className={styles.questions} aria-labelledby="marketing-questions-title">
    <div><h2 id="marketing-questions-title">Start with one job.<br />Bring your questions.</h2><p>See the <Link href="/pricing">plans and payment fees</Link>, or <Link href="/support">get in touch</Link> before you start.</p></div>
    <div>{questions.map(([question, answer]) => <details key={question}><summary>{question}</summary><p>{answer}</p></details>)}</div>
  </section>;
}
