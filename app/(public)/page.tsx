import Link from "next/link";
import type { Metadata } from "next";
import { ArrowDown, ArrowRight, ArrowUpRight, Check, CheckCheck, ChevronRight, CircleDollarSign, FileText, FolderOpen, LayoutDashboard, ListChecks, Plus, ShieldCheck, Users, Zap } from "lucide-react";
import { SocialLinks } from "@/components/social-links";
import { Button } from "@/components/ui/button";
import styles from "./home.module.css";
export const metadata: Metadata = {
    title: { absolute: "ServiceClerk — Job management for the trades" },
    description: "Your trade. Your business. All together. Quote, collect deposits, bill as you go, and keep the books clean with ServiceClerk.",
};
const steps = [
    { icon: FileText, title: "Send a better quote.", body: "Build from your saved pricing. Send a polished link that looks as professional as your work.", detail: "Your prices. Your branding." },
    { icon: ShieldCheck, title: "Get money down.", body: "Your customer approves, signs, and pays the deposit in one place. No account needed.", detail: "One link. Less back-and-forth." },
    { icon: ListChecks, title: "Bill as the work gets done.", body: "Capture the work with photos and send the next draw with the proof already attached.", detail: "Clear progress. Clear payments." },
    { icon: CheckCheck, title: "Close with clean books.", body: "Keep deposits, credits, and final invoices connected to the job, all the way to QuickBooks.", detail: "Enter it once. Keep it together." },
];
function JobPreview() {
    return (<figure className={styles.preview} aria-label="Illustrative ServiceClerk job overview with sample quote, deposit, and progress billing">
      <div className={styles.previewTop}><span className={styles.windowDots}><i /><i /><i /></span><span>YOUR BUSINESS, AT A GLANCE</span><span className={styles.previewAvatar}>JD</span></div>
      <div className={styles.previewBody}>
        <div className={styles.previewRail} aria-hidden="true"><span className={styles.railMark}>SC</span><LayoutDashboard /><FolderOpen className={styles.railActive}/><FileText /><Users /></div>
        <div className={styles.previewMain}>
          <div className={styles.breadcrumb}>Jobs <ChevronRight size={12}/> Kitchen renovation <span>Sample job</span></div>
          <div className={styles.jobHeading}><div><p>JOB #1042</p><h3>A brighter kitchen.<br />A job under control.</h3></div><span className={styles.jobIcon}><Zap size={23}/></span></div>
          <div className={styles.customer}>Morgan residence <span>•</span> Electrical <span className={styles.status}>In progress</span></div>
          <div className={styles.metrics}><div><span>Job value</span><strong>$8,400<span>.00</span></strong></div><div><span>Collected</span><strong>$4,200<span>.00</span></strong></div><div><span>Remaining</span><strong>$4,200<span>.00</span></strong></div></div>
          <div className={styles.progressLabel}><span>A clear path to paid</span><span>50% collected</span></div><div className={styles.progressBar}><span /></div>
          <div className={styles.timeline}>
            <div><span className={styles.done}><Check size={13}/></span><p><strong>Quote approved</strong><small>Signed and ready to go</small></p><b>$8,400</b></div>
            <div><span className={styles.done}><Check size={13}/></span><p><strong>Deposit received</strong><small>A good start, in the bank</small></p><b>$4,200</b></div>
            <div><span className={styles.current}><CircleDollarSign size={15}/></span><p><strong>Rough-in complete</strong><small>Next progress invoice</small></p><b>$2,520</b></div>
          </div>
          <div className={styles.previewFooter}><span><ShieldCheck size={14}/> Every detail, connected.</span><span>View job <ArrowUpRight size={13}/></span></div>
        </div>
      </div>
      <figcaption className={styles.paymentNote}><span className={styles.paymentIcon}><Check size={19}/></span><span><strong>Deposit paid. You’re good to go.</strong><small>One less thing to follow up on.</small></span><span className={styles.noteAmount}>+$4,200</span></figcaption>
    </figure>);
}
export default function LandingPage() {
    return (<div className={styles.home}>
      <section className={styles.hero}>
        <div className={styles.heroGrid}>
          <div className={styles.heroCopy}>
            <p className={styles.eyebrow}><span /> BUILT FOR THE WAY YOU WORK</p>
            <h1>Your trade.<br />Your business.<br /><span>All together.</span></h1>
            <p className={styles.heroDescription}>You do the work. ServiceClerk connects the rest — from the first quote to the final payment.</p>
            <div className={styles.heroActions}><Button asChild size="lg" className={styles.primaryButton}><Link href="/signup">Start your first quote <ArrowRight size={17}/></Link></Button><a href="#how-it-works" className={styles.textLink}>See how it works <ArrowDown size={15}/></a></div>
            <p className={styles.assurance}><Check size={14}/> Free to start <span>·</span> No credit card <span>·</span> Your prices, your way</p>
          </div>
          <div className={styles.heroVisual}><div className={styles.visualLabel}><span className={styles.labelLine}/> LESS PAPERWORK. MORE PEACE OF MIND.</div><JobPreview /><div className={styles.visualCaption}><span>01 — FROM THE FIRST QUOTE TO THE FINAL PAYMENT</span><span>All in a day’s work.</span></div></div>
        </div>
        <div className={styles.heroBottom}><p>A proper back office.<br /><strong>Without the extra pair of hands.</strong></p><div><FileText /> Quotes & contracts</div><div><CircleDollarSign /> Deposits & invoices</div><div><FolderOpen /> Jobs & customers</div><div><CheckCheck /> Connected books</div></div>
      </section>
      <section id="how-it-works" className={styles.workflow}>
        <div className={styles.sectionHeading}><div><p className={styles.eyebrow}>ONE JOB. ONE CONNECTED WORKFLOW.</p><h2>Great work deserves<br />a smoother way to get paid.</h2></div><p>No scattered spreadsheets. No re-entering the same details. Just a clear next step, from start to paid.</p></div>
        <div className={styles.steps}>{steps.map(({ icon: Icon, title, body, detail }, i) => <article className={styles.step} key={title}><div className={styles.stepTop}><span><Icon size={23} strokeWidth={1.5}/></span><small>0{i + 1}</small></div><h3>{title}</h3><p>{body}</p><div className={styles.stepDetail}><Check size={13}/>{detail}</div></article>)}</div>
      </section>
      <section className={styles.features}>
        <div className={styles.sectionHeading}><div><p className={styles.eyebrow}>SMALL DETAILS. A BIG DIFFERENCE.</p><h2>Built around your work.<br />Right down to the line item.</h2></div><Link href="/for/electricians" className={styles.textLink}>Explore it for electricians <ArrowUpRight size={17}/></Link></div>
        <div className={styles.featureGrid}>
          <article className={styles.priceFeature}><div><span className={styles.featureIcon}><FolderOpen size={21}/></span><h3>Your experience.<br />Your prices. Ready to go.</h3><p>Stop rebuilding the same quote. Your price book keeps what you actually charge, ready for the next job.</p></div><div className={styles.priceBook}><div className={styles.priceBookTitle}><span>YOUR PRICE BOOK</span><span>Electrical</span></div>{[{ name: "Recessed lighting", unit: "Supply & install · each", price: "$185.00" }, { name: "Dedicated 20A circuit", unit: "Wire, breaker & labor · each", price: "$325.00" }, { name: "GFCI receptacle", unit: "Supply & install · each", price: "$95.00" }].map(item => <div className={styles.priceRow} key={item.name}><span className={styles.priceItemIcon}><Zap size={16}/></span><div><strong>{item.name}</strong><small>{item.unit}</small></div><b>{item.price}</b><Plus size={15} aria-hidden="true"/></div>)}<p><CheckCheck size={14}/> Your numbers, ready for your next quote.<span>Sample pricing</span></p></div></article>
          <article className={styles.customerFeature}><span className={styles.featureIcon}><Users size={21}/></span><h3>Look as professional<br />as the work you do.</h3><p>Branded quotes, clear scope, and a simple way to sign and pay. All on their phone. All with your name on it.</p><div className={styles.approvalCard}><div><span className={styles.contractorMark}><Zap size={16}/></span><span>YOUR BUSINESS<small>Prepared for Morgan residence</small></span><ShieldCheck size={19}/></div><span className={styles.quoteLabel}>Kitchen electrical renovation</span><strong>$8,400.00</strong><div className={styles.approved}><Check size={15}/> Quote approved & signed</div><p>No download. No customer account.</p></div></article>
          <article className={styles.smallFeature}><ShieldCheck size={23}/><div><h3>The right license. Every time.</h3><p>The right number on the right document, with a heads-up before a license expires.</p></div></article>
          <article className={styles.smallFeature}><FileText size={23}/><div><h3>Keep changes in writing.</h3><p>Turn extra work into a change order your customer can review and approve, with billing connected to the job.</p></div></article>
        </div>
      </section>
      <section className={styles.closing}><div className={styles.closingAccent} aria-hidden="true">SC</div><div><p className={styles.eyebrow}>LESS ADMIN. MORE OF YOUR EVENING.</p><h2>Your next job.<br />A better way to run it.</h2><p>Bring one job you owe someone a number on.<br />That’s the whole setup.</p><Button asChild size="lg" className={styles.primaryButton}><Link href="/signup">Start your first quote <ArrowRight size={17}/></Link></Button><span className={styles.closingNote}>Free to start. No credit card needed.</span></div></section>
      <section className={styles.builder}><div><span className={styles.builderDot}/><p><strong>Built in the open. Built with you.</strong><span>One independent builder, working alongside the contractors using it.</span></p></div><SocialLinks className="gap-x-5 text-sm text-muted-foreground"/></section>
    </div>);
}
