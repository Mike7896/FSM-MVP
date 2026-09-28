"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  useEffect,
  useState,
  useSyncExternalStore,
  type FormEvent,
  type ReactNode,
} from "react";
import { ArrowRight, ChevronRight, Loader2 } from "lucide-react";
import { toast } from "sonner";

import { DemoChip } from "@/components/demo-chip";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { StartState } from "@/lib/queries/activation";
import { TRADE_IDS, TRADE_LABELS, type TradeId } from "@/lib/trades";
import { cn } from "@/lib/utils";

/**
 * Screen 3 · the start choice — and 16a, the one question before it.
 *
 * **Three starts, and they are not equal.** Quote a real job is first, framed,
 * and holds the only button on the screen, with the reason given in his words:
 * only the real start activates. The demo and the skip are rows — one tap away,
 * never weighted the same — because offered flat, most people take the
 * lowest-commitment option and none of them activate.
 *
 * **The input is still the design.** The smallest possible act of real work
 * sits inside the recommended start. Any text is valid — no format, no minimum,
 * no message — and once he has typed, the other two drop their explanations:
 * he has chosen, and they stay reachable without competing.
 *
 * **The trade question comes first, once.** One tap, no Next button, skippable,
 * and absent for anyone who came in through a trade door — they answered it
 * before they signed up.
 */

const EYEBROW =
  "text-muted-foreground font-label text-[11px] uppercase";

const TRADE_SKIPPED = "welcome:trade-skipped";

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
    <div className="mx-auto flex w-full max-w-md flex-col gap-8 px-4 py-12">
      <div>
        <p className={EYEBROW}>One question, then we build</p>
        <h1 className="mt-3 text-3xl leading-tight font-semibold tracking-tight text-balance">
          What do you do?
        </h1>
        <p className="text-muted-foreground mt-3 leading-relaxed">
          So the line items and the scope language start in your language.
        </p>
      </div>

      <div className="grid grid-cols-2 gap-2">
        {TRADE_IDS.map((trade) => (
          <Button
            key={trade}
            variant="outline"
            size="lg"
            className="h-12 justify-start text-base"
            onClick={() => onChoose(trade)}
          >
            {TRADE_LABELS[trade]}
          </Button>
        ))}
      </div>

      <div className="flex flex-col items-center gap-2 text-center">
        <button
          type="button"
          onClick={onSkip}
          className="text-muted-foreground hover:text-foreground text-sm underline underline-offset-4"
        >
          Skip — I&apos;ll say later
        </button>
        <p className="text-muted-foreground text-xs">
          Not asked again this session. Nothing here costs anything.
        </p>
      </div>
    </div>
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
  const [seed, setSeed] = useState("");
  const [starting, setStarting] = useState(false);
  const [skipping, setSkipping] = useState(false);

  const typed = seed.trim() !== "";

  function start(event: FormEvent) {
    event.preventDefault();
    if (!typed || starting) return;
    setStarting(true);
    router.push(`/welcome/quote?seed=${encodeURIComponent(seed.trim())}`);
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
    <div className="mx-auto flex w-full max-w-md flex-col gap-8 px-4 py-10 md:max-w-2xl md:py-16">
      <div>
        {returning ? (
          <>
            <h1 className="text-3xl leading-tight font-semibold tracking-tight text-balance">
              What are we quoting?
            </h1>
            <p className="text-muted-foreground mt-3 leading-relaxed">
              Nothing sent yet. Start with a job you&apos;ve already got.
            </p>
          </>
        ) : (
          <>
            <p className={EYEBROW}>
              You&apos;re in{firstName ? `, ${firstName}` : ""}
            </p>
            <h1 className="mt-3 text-3xl leading-tight font-semibold tracking-tight text-balance">
              Let&apos;s build a quote you can actually send.
            </h1>
            <p className="text-muted-foreground mt-3 leading-relaxed">
              About ten minutes. You can change every number.
            </p>
          </>
        )}
      </div>

      {/* The recommended start: framed, first, and the only button. */}
      <form
        onSubmit={start}
        className="bg-card flex flex-col gap-5 rounded-xl border p-5 shadow-sm md:p-6"
      >
        <div>
          {returning ? null : (
            <p className="text-primary-ink font-label text-[11px] uppercase">
              Start here
            </p>
          )}
          <h2 className="mt-1 text-lg font-semibold">Quote a real job</h2>
          {returning ? null : (
            <p className="text-muted-foreground mt-1 text-sm leading-relaxed">
              Works best on a job you actually owe someone. At the end it goes
              to them, for real.
            </p>
          )}
        </div>

        <div className="flex flex-col gap-2">
          <Label htmlFor="seed" className={EYEBROW}>
            Who&apos;s it for, and what&apos;s the work?
          </Label>
          {/* At the desk the input and its button are one row, so the act
              reads as a single gesture (3d). */}
          <div className="flex flex-col gap-3 md:flex-row">
            <Input
              id="seed"
              autoFocus={!returning}
              autoComplete="off"
              value={seed}
              onChange={(event) => setSeed(event.target.value)}
              className="h-12 text-base md:flex-1"
            />
            <Button
              type="submit"
              size="lg"
              className="h-12"
              disabled={!typed || starting}
            >
              {starting ? <Loader2 className="animate-spin" /> : null}
              Start this quote
              {starting ? null : <ArrowRight />}
            </Button>
          </div>
        </div>
      </form>

      {/* The alternates. Side by side at the desk rather than stacking into a
          menu, and quieter the moment he has typed. */}
      <div className={cn("grid gap-1 border-t pt-3", !typed && "md:grid-cols-2")}>
        {demoQuote ? (
          <StartRow
            href={
              demoQuote.sentAt
                ? `/quotes/${demoQuote.id}/sent`
                : `/quotes/${demoQuote.id}`
            }
            title={
              <>
                Pick up your demo quote <DemoChip />
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
            title={typed ? "Build a demo quote instead" : "Build a demo quote"}
            detail={
              typed
                ? null
                : "Nothing to quote right now. Same screens, labelled a demo — it stays in your account and never goes to a customer."
            }
          />
        )}

        {returning ? (
          <StartRow href="/dashboard" title="Go to my dashboard" detail={null} />
        ) : (
          <StartRow
            onClick={skip}
            pending={skipping}
            title="Skip to the dashboard"
            detail={
              typed
                ? null
                : "Pick the tour up any time before your first real send."
            }
          />
        )}
      </div>
    </div>
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
    "hover:bg-muted/50 focus-visible:ring-ring/50 flex w-full items-center gap-4 rounded-lg px-3 py-3 text-left transition-colors outline-none focus-visible:ring-3";

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
