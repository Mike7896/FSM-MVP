"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type FormEvent,
  type ReactNode,
} from "react";
import { ArrowRight, ChevronRight, Loader2, Zap, Droplets, Wind, Hammer, House, Wrench } from "lucide-react";
import { toast } from "sonner";

import { DemoChip } from "@/components/demo-chip";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { StartState } from "@/lib/queries/activation";
import { TRADE_IDS, TRADE_LABELS, type TradeId } from "@/lib/trades";
import "./start-choice.css";

/**
 * Screen 3 · the start choice — and 16a, the one question before it.
 *
 * **Three starts, and they are not equal.** Start your first quote is first, framed,
 * and holds the only button on the screen, with the reason given in his words:
 * only the real start activates. The demo and the skip are rows — one tap away,
 * never weighted the same — because offered flat, most people take the
 * lowest-commitment option and none of them activate.
 *
 * Separate fields capture the customer and work without punctuation guessing.
 *
 * **The trade question comes first, once.** One tap, no Next button, skippable,
 * and absent for anyone who came in through a trade door — they answered it
 * before they signed up.
 */

const EYEBROW =
  "text-muted-foreground font-label text-[11px] uppercase";

const TRADE_SKIPPED = "welcome:trade-skipped";

const TRADE_ICONS = { electrical: Zap, plumbing: Droplets, hvac: Wind, remodel: Hammer, roofing: House, other: Wrench };

/** A continuation of the auth pages: a job's story beside one focused action. */
function StartFrame({ step, children }: { step: "trade" | "quote"; children: ReactNode }) {
  const content = useRef<HTMLDivElement>(null);
  useEffect(() => {
    content.current?.querySelector("h1")?.focus({ preventScroll: true });
    window.scrollTo(0, 0);
  }, [step]);
  return (
    <div className="start-shell">
      <aside className="start-story" aria-label="From quote to payment">
        <p className="start-kicker">Your work. All together.</p>
        <div className="start-story-body">
          <p className="start-manifesto">Good work.<br />Less admin.<br /><span>Start here.</span></p>
          <p className="start-story-description">The quote is just the beginning. Keep the details, the decisions, and the payments with the job.</p>
          <ol className="start-job-path">
            {[
              ["Quote the work", "Give your customer a clear scope and price."],
              ["Agree on the details", "Turn the quote into a contract. Track changes."],
              ["Bill as the job moves", "Collect deposits and bill completed phases."],
              ["Finish with everything on file", "Keep the job history and final invoice together."],
            ].map(([title, detail], index) => (
              <li key={title}><span className="start-path-number">0{index + 1}</span><div><p>{title}</p><span>{detail}</span></div></li>
            ))}
          </ol>
        </div>
        <p className="start-story-footer">From the first conversation to the final payment.</p>
      </aside>
      <div className="start-workspace">
        <nav className="start-progress" aria-label="Getting started">
          <span aria-current={step === "trade" ? "step" : undefined}><span>01</span> Your trade</span>
          <span className="start-progress-line" aria-hidden="true" />
          <span aria-current={step === "quote" ? "step" : undefined}><span>02</span> Your first quote</span>
        </nav>
        <div ref={content} className="start-content">{children}</div>
        <p className="start-help">Need a hand? <Link href="/support">Contact support <ArrowRight size={13} aria-hidden="true" /></Link></p>
      </div>
    </div>
  );
}

// Nothing to subscribe to: the skip only changes by the tap that also moves
// this screen on, so a read per render is the whole contract.
const subscribe = () => () => {};

function readSkipped() {
  try {
    return sessionStorage.getItem(TRADE_SKIPPED) === "1";
  } catch {
    return false;
  }
}

async function saveTrade(trade: TradeId) {
  const response = await fetch("/api/v1/profile", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ trade }),
  }).catch(() => null);
  return response?.ok ?? false;
}

export function StartChoice({
  firstName,
  returning,
  hasOrganization,
  demoQuote,
  askTrade,
  doorTrade,
}: {
  firstName: string | null;
  /** Back again with nothing real sent — no second welcome (3c). */
  returning: boolean;
  hasOrganization: boolean;
  /** The demo he already has, if he built one. */
  demoQuote: StartState["demoQuote"];
  askTrade: boolean;
  /** The trade a front door already named — saved without asking. */
  doorTrade: TradeId | null;
}) {
  // Skipped earlier in this tab's session: not asked again (16a).
  const skipped = useSyncExternalStore(subscribe, readSkipped, () => false);
  const [answered, setAnswered] = useState(false);

  useEffect(() => {
    if (doorTrade) void saveTrade(doorTrade);
  }, [doorTrade]);

  if (askTrade && !answered && !skipped) {
    return (
      <TradeQuestion
        onChoose={(trade) => {
          setAnswered(true);
          void saveTrade(trade).then((saved) => {
            if (!saved) {
              toast.error("Couldn't save your trade. Nothing else is affected.");
            }
          });
        }}
        onSkip={() => {
          try {
            sessionStorage.setItem(TRADE_SKIPPED, "1");
          } catch {
            // Private browsing: the skip still holds for as long as this page does.
          }
          setAnswered(true);
        }}
      />
    );
  }

  return (
    <Starts
      firstName={firstName}
      returning={returning}
      hasOrganization={hasOrganization}
      demoQuote={demoQuote}
    />
  );
}

/** 16a · recognition, not a form. Tapping a trade is the submit. */
function TradeQuestion({
  onChoose,
  onSkip,
}: {
  onChoose: (trade: TradeId) => void;
  onSkip: () => void;
}) {
  return (
    <StartFrame step="trade">
      <div className="start-heading">
        <p className={EYEBROW}>Make yourself at home</p>
        <h1 tabIndex={-1}>
          What kind of work do you do?
        </h1>
        <p>
          Tell us where you spend your day. Pick the closest match; you can change it in your profile anytime.
        </p>
      </div>

      <div className="start-trades" aria-label="Choose your trade">
        {TRADE_IDS.map((trade) => {
          const Icon = TRADE_ICONS[trade];
          return <button
            type="button"
            key={trade}
            className="start-trade"
            onClick={() => onChoose(trade)}
          >
            <Icon className="start-trade-icon" aria-hidden="true" />
            <span>{TRADE_LABELS[trade]}</span>
            <ChevronRight className="start-trade-arrow" aria-hidden="true" />
          </button>;
        })}
      </div>

      <div className="start-skip">
        <button
          type="button"
          onClick={onSkip}
          className="start-skip-button"
        >
          Skip for now <ArrowRight size={15} aria-hidden="true" />
        </button>
        <p className="text-muted-foreground text-xs">
          Every trade can start a quote. This choice does not change your plan.
        </p>
      </div>
    </StartFrame>
  );
}

/** 3a–3d · the three starts. */
function Starts({
  firstName,
  returning,
  hasOrganization,
  demoQuote,
}: {
  firstName: string | null;
  returning: boolean;
  hasOrganization: boolean;
  demoQuote: StartState["demoQuote"];
}) {
  const router = useRouter();
  const [customerName, setCustomerName] = useState("");
  const [workTitle, setWorkTitle] = useState("");
  const [starting, setStarting] = useState(false);
  const [skipping, setSkipping] = useState(false);

  const typed = customerName.trim() !== "" || workTitle.trim() !== "";
  const ready = Boolean(customerName.trim() && workTitle.trim());

  function start(event: FormEvent) {
    event.preventDefault();
    if (!ready || starting) return;
    setStarting(true);
    const params = new URLSearchParams({ customerName: customerName.trim(), title: workTitle.trim() });
    router.push(`/welcome/quote?${params}`);
  }

  /**
   * Skipping still needs somewhere for his work to live. The Office is created
   * without a name — the name is asked for at the letterhead, where a customer
   * would see it.
   */
  async function skip() {
    setSkipping(true);
    if (!hasOrganization) {
      const response = await fetch("/api/v1/organizations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      }).catch(() => null);

      // Already has one — a second tab, a double tap. Either way there's a
      // dashboard to go to.
      if (!response?.ok && response?.status !== 409) {
        setSkipping(false);
        toast.error("Couldn't reach the server. Try again.");
        return;
      }
    }
    router.push("/dashboard");
  }

  return (
    <StartFrame step="quote">
      <div className="start-heading">
        <p className={EYEBROW}>{returning ? "Pick up from here" : `Welcome${firstName ? `, ${firstName}` : ""}`}</p>
        <h1 tabIndex={-1}>Start with a job<br className="hidden sm:block" /> you have in mind.</h1>
        <p>A customer and a work title are all you need to begin. Add your scope and prices in the quote editor next.</p>
      </div>

      {/* The recommended start: framed, first, and the only button. */}
      <form
        onSubmit={start}
        className="start-form"
      >
        <div className="grid gap-5">
          <div className="grid gap-2">
            <Label htmlFor="quote-customer">Customer name</Label>
            <Input id="quote-customer" autoComplete="off"
              placeholder="Jordan Lee" maxLength={160} required value={customerName}
              onChange={(event) => setCustomerName(event.target.value)} className="start-input" />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="quote-title">Work title</Label>
            <Input id="quote-title" autoComplete="off" placeholder="Kitchen faucet replacement"
              maxLength={200} required value={workTitle}
              onChange={(event) => setWorkTitle(event.target.value)} className="start-input" />
          </div>
        </div>
        <div className="grid gap-3">
          <Button type="submit" size="lg" className="start-submit" disabled={!ready || starting}>
            {starting ? <Loader2 className="animate-spin" /> : null}
            {starting ? "Opening your quote..." : "Create my first quote"}
            {starting ? null : <ArrowRight aria-hidden="true" />}
          </Button>
          <p className="start-reassurance">Nothing goes to your customer until you choose to send it.</p>
        </div>
      </form>

      {/* The alternates. Side by side at the desk rather than stacking into a
          menu, and quieter the moment he has typed. */}
      <div className="start-alternates">
        {demoQuote ? (
          <StartRow
            href={
              demoQuote.sentAt
                ? `/quotes/${demoQuote.id}/sent`
                : `/quotes/${demoQuote.id}`
            }
            title={
              <>
                Continue your practice quote <DemoChip />
              </>
            }
            detail={
              <span suppressHydrationWarning>
                {[demoQuote.customerName, demoQuote.title]
                  .filter(Boolean)
                  .join(" — ")}{" "}
                · started {startedOn(demoQuote.createdAt)}
              </span>
            }
          />
        ) : (
          <StartRow
            href="/welcome/quote?demo=1"
            title={typed ? "Try a practice quote instead" : "Try a practice quote"}
            detail={
              typed
                ? null
                : "Explore the quote editor with a practice draft. You can send it to yourself to see the customer experience."
            }
          />
        )}

        {returning ? (
          <StartRow href="/dashboard" title="Go to my dashboard" detail={null} />
        ) : (
          <StartRow
            onClick={skip}
            pending={skipping}
            title="Explore the dashboard"
            detail={
              typed
                ? null
                : "Look around first. Start a quote whenever you’re ready."
            }
          />
        )}
      </div>
    </StartFrame>
  );
}

/** One alternate start. A row, never a card — it must not look like the ask. */
function StartRow({
  title,
  detail,
  href,
  onClick,
  pending = false,
}: {
  title: ReactNode;
  detail: ReactNode;
  href?: string;
  onClick?: () => void;
  pending?: boolean;
}) {
  const body = (
    <>
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-2 text-sm font-medium">
          {title}
        </span>
        {detail ? (
          <span className="text-muted-foreground mt-1 block text-sm leading-relaxed">
            {detail}
          </span>
        ) : null}
      </span>
      {pending ? (
        <Loader2 className="text-muted-foreground size-4 shrink-0 animate-spin" />
      ) : (
        <ChevronRight className="text-muted-foreground size-4 shrink-0" />
      )}
    </>
  );

  const className =
    "start-alternate";

  return href ? (
    <Link href={href} className={className}>
      {body}
    </Link>
  ) : (
    <button
      type="button"
      onClick={onClick}
      disabled={pending}
      className={className}
    >
      {body}
    </button>
  );
}

/** "Tuesday" within the week, a date after that. */
function startedOn(iso: string) {
  const date = new Date(iso);
  const age = Date.now() - date.getTime();
  return age < 6 * 86_400_000
    ? date.toLocaleDateString("en-US", { weekday: "long" })
    : date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}
