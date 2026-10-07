import Link from "next/link";
import { ArrowLeftIcon, ArrowUpRightIcon } from "lucide-react";
import { Wordmark } from "@/components/brand";
import "./auth.css";

/** Shared by account, recovery, invitation, and OAuth error screens. */
export function AuthShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="auth-shell">
      <aside className="auth-story dark" aria-label="ServiceClerk">
        <Link href="/" className="auth-brand" aria-label="ServiceClerk home"><Wordmark size={27} /></Link>
        <div className="auth-story-copy">
          <p className="auth-manifesto">Less<br />paperwork.<br /><span>More day.</span></p>
          <p className="auth-story-description">From the first quote to the final invoice.<br />Keep the job together with ServiceClerk.</p>
        </div>
        <div className="auth-story-footer"><span>Built for the trades.</span><span>Ready for the day.</span></div>
      </aside>
      <div className="auth-workspace">
        <header className="auth-navigation">
          <Link href="/" className="auth-back"><ArrowLeftIcon size={15} aria-hidden="true" /><span className="auth-desktop-back">Back to home</span><span className="auth-mobile-brand"><Wordmark size={23} /></span></Link>
          <Link href="/support" className="auth-support">Need a hand? <ArrowUpRightIcon size={15} aria-hidden="true" /></Link>
        </header>
        <main className="auth-main">{children}</main>
        <footer className="auth-footer"><span>ServiceClerk</span><div><Link href="/legal/privacy">Privacy</Link><Link href="/legal/terms">Terms</Link></div></footer>
      </div>
    </div>
  );
}
