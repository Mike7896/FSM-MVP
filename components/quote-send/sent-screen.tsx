"use client";

import { reportFreeLimit } from "@/lib/membership/limit-event";

import {
  useEffect,
  useRef,
  useState,
  type ChangeEvent,
  type ReactNode,
} from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft, ArrowRight, Check, Copy, ExternalLink, Loader2 } from "lucide-react";
import { toast } from "sonner";

import { DemoChip } from "@/components/demo-chip";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import type { QuoteTimeline } from "@/lib/queries/quote-timeline";
import { formatMoney } from "@/lib/quote";
import { cn } from "@/lib/utils";

/**
 * Screen 11 · where a sent quote stands — with the teach beat (9b) beside it and
 * the post-send offers (10) beneath, or the demo handoff (15a) instead.
 *
 * **A timeline, not a dashboard.** Sent, opened, accepted, signed, paid — each
 * read from the record that proves it — and unreached steps stay present but
 * quiet, so the money workflow teaches its own shape before he has run it.
 *
 * **The primary action is a function of her behaviour, not his.** Nothing yet:
 * nothing to do, and the screen refuses to invent a task. Opened: he knows,
 * which is the value. Quiet three days: a check-in, written for him and sent by
 * him. Approved but unsigned: what not to do yet.
 *
 * **A demo ends on a handoff, never a confirmation** (15a) — the moment a real
 * one is cheapest to say yes to. Reached again later from the demo itself, it
 * is the ordinary timeline with the same ask underneath (15b).
 */

export type SentPlace = "activation" | "app";

const DAY = 86_400_000;
/** Silence long enough to offer a check-in (11d). */
const QUIET_DAYS = 3;

const EYEBROW =
  "text-muted-foreground font-label text-[11px] uppercase";

export function SentScreen({
  timeline,
  place,
  now,
  emailEnabled,
  teach,
  offers,
}: {
  timeline: QuoteTimeline;
  place: SentPlace;
  /** The server's clock, so every "3 days" on the page agrees with itself. */
  now: string;
  emailEnabled: boolean;
  /** The one teach beat — a first real send, once in the whole product. */
  teach: boolean;
  /** The offers that apply to this quote, or null once he's said no thanks. */
  offers: { logo: boolean; deposit: boolean; feeLine: string } | null;
}) {
  const router = useRouter();
  const { quote, customer, url, opens, contract, depositPaidAt } = timeline;

  const first = firstName(customer.name);
  const nowMs = Date.parse(now);

  const [teachOpen, setTeachOpen] = useState(teach);
  const [offersOpen, setOffersOpen] = useState(offers !== null);

  // Spent the moment it shows, not when it's dismissed. Gone means gone: if
  // the lesson didn't land in one beat, it's taught later by doing.
  const spent = useRef(false);
  useEffect(() => {
    if (!teach || spent.current) return;
    spent.current = true;
    void patchProfile({ teachSeen: true });
  }, [teach]);

  if (quote.demo && place === "activation") {
    return <Handoff url={url} />;
  }

  const approved = quote.status === "accepted";
  const declined = quote.status === "declined";
  const answered = approved || declined;

  const sentMs = quote.sentAt ? Date.parse(quote.sentAt) : nowMs;
  const lastHeard = opens[0] ? Date.parse(opens[0]) : sentMs;
  const quietDays = Math.floor((nowMs - lastHeard) / DAY);
  const quiet = !quote.demo && !answered && quietDays >= QUIET_DAYS;

  const unsigned =
    approved && contract !== null && !contract.customerSignedAt;
  const unsignedDays = quote.acceptedAt
    ? Math.max(1, Math.floor((nowMs - Date.parse(quote.acceptedAt)) / DAY))
    : 1;

  const deposit =
    quote.depositCents !== null && quote.depositCents > 0
      ? quote.depositCents
      : null;

  const state = depositPaidAt
    ? "Paid"
    : unsigned
      ? plural(unsignedDays, "day")
      : approved
        ? "Accepted"
        : declined
          ? "Declined"
          : quiet
            ? plural(quietDays, "day")
            : opens.length > 0
              ? "Opened"
              : "Sent";

  const channelLine = quote.demo
    ? quote.sentChannel === "email"
      ? `Emailed to ${quote.sentTo}. Open it the way a customer would.`
      : "Sent as a link. Open it the way a customer would."
    : quote.sentChannel === "email"
      ? `Emailed to ${quote.sentTo}. You'll know the moment ${first} opens it.`
      : `Sent as a link. You'll know the moment ${first} opens it.`;

  const sentDetail = quote.demo
    ? "to you"
    : quote.sentChannel === "email"
      ? `emailed to ${quote.sentTo}`
      : "as a link";

  const openedDetail =
    opens.length === 0
      ? "Not yet — you'll see it here"
      : opens.length === 1
        ? `${clock(opens[0], nowMs)}${quote.demo ? " · by you" : ""}`
        : opens.length === 2
          ? `${clock(opens[1], nowMs)}, and again ${clock(opens[0], nowMs, true)}`
          : `Last ${clock(opens[0], nowMs, true)}`;

  async function copyLink() {
    if (!url) return;
    try {
      await navigator.clipboard.writeText(url);
      toast.success("Link copied.");
    } catch {
      toast.message("Your link", { description: url });
    }
  }

  const teachBeat = teachOpen ? (
    <TeachBeat
      jobId={quote.jobId}
      first={first}
      onDone={() => setTeachOpen(false)}
    />
  ) : null;

  const offerList =
    offersOpen && offers ? (
      <Offers
        first={first}
        logo={offers.logo}
        deposit={offers.deposit && deposit !== null}
        feeLine={offers.feeLine}
        onDismiss={() => {
          setOffersOpen(false);
          void patchProfile({ offersDismissed: true });
        }}
      />
    ) : null;

  const aside = teachBeat !== null || offerList !== null;

  return (
    <div
      className={cn(
        "mx-auto flex w-full max-w-5xl flex-col gap-6",
        place === "activation" && "px-4 py-8 md:py-12"
      )}
    >
      <div className="flex items-center justify-between gap-3">
        <Link
          href={`/quotes/${quote.id}`}
          className="text-muted-foreground hover:text-foreground flex min-w-0 items-center gap-1.5 text-sm"
        >
          <ArrowLeft className="size-4 shrink-0" />
          <span className="truncate">{customer.name || "The quote"}</span>
        </Link>
        <div className="flex shrink-0 items-center gap-2">
          {quote.demo ? <DemoChip /> : null}
          <Badge
            variant="outline"
            className="font-label uppercase"
          >
            {state}
          </Badge>
          {/* Sending is when the job starts being worked on, so the way to it
              sits up top on every visit, not only in the one-time beat. */}
          <Button asChild size="sm">
            <Link href={`/jobs/${quote.jobId}`}>
              {quote.jobNumber ? `Go to job #${quote.jobNumber}` : "Go to the job"}
              <ArrowRight />
            </Link>
          </Button>
        </div>
      </div>

      <div
        className={cn(
          "grid items-start gap-6",
          aside && "lg:grid-cols-[minmax(0,1fr)_22rem]"
        )}
      >
        <div className="flex min-w-0 flex-col gap-6">
          <section className="rounded-xl border p-5 md:p-6">
            {depositPaidAt && deposit !== null ? (
              // Money first: the amount received is the hero, and the timeline
              // becomes the receipt underneath it (11c).
              <>
                <p className={EYEBROW}>Deposit received</p>
                <p className="mt-2 text-3xl font-semibold tabular-nums">
                  {formatMoney(deposit)}
                </p>
                <p className="text-muted-foreground mt-1.5 text-sm">
                  {formatMoney(quote.totalCents - deposit)} due on completion.
                </p>
              </>
            ) : (
              <>
                <p className={EYEBROW} suppressHydrationWarning>
                  Sent · {clock(quote.sentAt, nowMs)}
                </p>
                <h1 className="mt-2 text-2xl font-semibold tracking-tight text-balance">
                  {quote.demo
                    ? "Sent to you, not to a customer."
                    : `Quote's with ${first}.`}
                </h1>
                <p className="text-muted-foreground mt-1.5 text-sm">
                  {channelLine}
                </p>
              </>
            )}

            <dl className="mt-5 flex flex-col gap-2 border-t pt-4 text-sm">
              <div className="flex items-baseline justify-between gap-4">
                <dt className="min-w-0 truncate">
                  {quote.title || quote.number || "Quote"}
                </dt>
                <dd className="font-semibold tabular-nums">
                  {formatMoney(quote.totalCents)}
                </dd>
              </div>
              <div className="text-muted-foreground flex items-baseline justify-between gap-4">
                <dt>{deposit !== null ? "Deposit on signing" : "Due on completion"}</dt>
                <dd className="tabular-nums">
                  {formatMoney(deposit ?? quote.totalCents)}
                </dd>
              </div>
            </dl>
          </section>

          {/* On a phone the beat sits right under the good news, which stays
              visible above it. At the desk it moves beside it. */}
          {teachBeat ? <div className="lg:hidden">{teachBeat}</div> : null}

          <section className="rounded-xl border px-5 py-1">
            <ol>
              <Step
                reached
                title="Sent"
                detail={`${clock(quote.sentAt, nowMs)} · ${sentDetail}`}
              />
              <Step
                reached={opens.length > 0}
                title={openedTitle(opens.length)}
                detail={openedDetail}
              />
              <Step
                reached={answered}
                title={declined ? "Declined" : "Accepted"}
                detail={
                  approved && quote.acceptedAt
                    ? clock(quote.acceptedAt, nowMs)
                    : null
                }
              />
              {contract ? (
                <Step
                  reached={Boolean(
                    contract.contractorSignedAt && contract.customerSignedAt
                  )}
                  title="Contract signed by both"
                  detail={
                    contract.customerSignedAt
                      ? clock(contract.customerSignedAt, nowMs)
                      : contract.contractorSignedAt
                        ? "Your signature is on it · not signed yet"
                        : null
                  }
                />
              ) : null}
              {deposit !== null ? (
                <Step
                  reached={Boolean(depositPaidAt)}
                  title="Deposit paid"
                  detail={depositPaidAt ? clock(depositPaidAt, nowMs) : null}
                />
              ) : null}
            </ol>
          </section>

          {opens.length > 0 && !answered && !quiet && !quote.demo ? (
            <p className="text-muted-foreground text-sm">
              {capitalize(first)}&apos;s read it. Still nothing for you to do —
              but now you know whether a call is worth making.
            </p>
          ) : null}

          {quiet ? (
            <CheckIn
              quoteId={quote.id}
              first={first}
              customerEmail={customer.email}
              emailEnabled={emailEnabled}
              onSent={() => router.refresh()}
            />
          ) : null}

          {unsigned ? (
            <section className="border-l-foreground rounded-xl border border-l-4 p-5">
              <p className="font-semibold">
                {capitalize(first)} said yes but hasn&apos;t signed.
              </p>
              <p className="text-muted-foreground mt-1 text-sm">
                No deposit until {first} signs, and don&apos;t order materials
                on a yes. It&apos;s been on the link{" "}
                {plural(unsignedDays, "day")}.
              </p>
              <div className="mt-4 flex flex-wrap gap-2">
                {customer.phone ? (
                  <Button asChild size="sm">
                    <a href={`tel:${customer.phone}`}>Call {first}</a>
                  </Button>
                ) : null}
                {url ? (
                  <Button size="sm" variant="outline" onClick={copyLink}>
                    <Copy />
                    Copy link
                  </Button>
                ) : null}
              </div>
            </section>
          ) : null}

          {/* Both about the link, not about him doing more work — equal weight,
              and no primary action while she decides (11a). */}
          {url ? (
            <div className="flex flex-wrap gap-2">
              <Button asChild variant="outline">
                <a href={url} target="_blank" rel="noreferrer">
                  <ExternalLink />
                  {quote.demo ? "View customer preview" : `View what ${first} sees`}
                </a>
              </Button>
              <Button variant="outline" onClick={copyLink}>
                <Copy />
                Copy link
              </Button>
              <Button asChild variant="outline">
                <Link href={`/quotes/${quote.id}/info-request`}>Questions and replies</Link>
              </Button>
            </div>
          ) : null}

          {quote.demo ? (
            // 15b · the handoff's second door, from the object itself.
            <section className="rounded-xl border p-5">
              <p className="font-semibold">Do this one for real?</p>
              <p className="text-muted-foreground mt-1 text-sm">
                A real quote starts fresh — this one stays here as a demo.
              </p>
              <Button asChild className="mt-4">
                <Link href="/quotes/new">Quote a real job</Link>
              </Button>
              <p className="text-muted-foreground mt-3 text-xs">
                Not counted in your money, your gates or your price book.
              </p>
            </section>
          ) : null}
        </div>

        {aside ? (
          <div className="flex flex-col gap-6">
            {teachBeat ? (
              <div className="hidden lg:block">{teachBeat}</div>
            ) : null}
            {offerList}
          </div>
        ) : null}
      </div>
    </div>
  );
}

/** One step on the timeline. Unreached steps are drawn quiet, never hidden. */
function Step({
  reached,
  title,
  detail,
}: {
  reached: boolean;
  title: string;
  detail: string | null;
}) {
  return (
    <li className="flex gap-3 border-t py-3 first:border-t-0">
      <span
        className={cn(
          "mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full border",
          reached
            ? "border-foreground bg-foreground text-background"
            : "border-muted-foreground/40"
        )}
      >
        {reached ? <Check className="size-3" /> : null}
      </span>
      <div className="min-w-0">
        <p className={cn("text-sm font-medium", !reached && "text-muted-foreground")}>
          {title}
        </p>
        {detail ? (
          <p
            className="text-muted-foreground mt-0.5 text-xs"
            suppressHydrationWarning
          >
            {detail}
          </p>
        ) : null}
      </div>
    </li>
  );
}

/**
 * 9b · the automation variant — the only teach beat that ships.
 *
 * States something that already happened; nothing to configure, nothing to
 * accept. One beat, never a sequence.
 */
function TeachBeat({
  jobId,
  first,
  onDone,
}: {
  jobId: string;
  first: string;
  onDone: () => void;
}) {
  return (
    <section className="bg-card rounded-xl border p-5 shadow-sm">
      <p className={EYEBROW}>What happens next</p>
      <p className="mt-2 text-lg font-semibold">This is a job now.</p>
      <p className="text-muted-foreground mt-1 text-sm leading-relaxed">
        Everything after this — {first}&apos;s answer, the contract, the
        deposit, the invoices — lands on the job. No re-typing, no second app.
      </p>
      <div className="mt-4 flex gap-2">
        <Button asChild size="sm" variant="outline">
          <Link href={`/jobs/${jobId}`}>See the job</Link>
        </Button>
        <Button size="sm" onClick={onDone}>
          Got it
        </Button>
      </div>
    </section>
  );
}

/**
 * 10 · the post-send offers — every one attaches to the business, and each
 * visibly improves the quote she already has.
 *
 * Deliberately no primary action: the job is done, so this is the one surface
 * that offers a choice rather than a next step. Computed from what this quote
 * contains — no deposit, no payment offer — and dismissed as a group, for good.
 */
function Offers({
  first,
  logo,
  deposit,
  feeLine,
  onDismiss,
}: {
  first: string;
  logo: boolean;
  deposit: boolean;
  /** What online payments cost, for the deposit offer. */
  feeLine: string;
  onDismiss: () => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [logoState, setLogoState] = useState<"idle" | "uploading" | "added">(
    "idle"
  );

  async function upload(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;

    setLogoState("uploading");
    try {
      const slot = await api<{ path: string; signedUrl: string }>(
        "/api/v1/office/logo",
        "POST",
        { fileName: file.name }
      );

      // Straight to Storage, the way the Supabase client sends it — the file
      // never passes through this app's server.
      const form = new FormData();
      form.append("cacheControl", "3600");
      form.append("", file);
      const put = await fetch(slot.signedUrl, { method: "PUT", body: form });
      if (!put.ok) throw new Error("The upload didn't go through. Try again.");

      await api("/api/v1/office/logo", "PUT", { path: slot.path });
      setLogoState("added");
    } catch (cause) {
      setLogoState("idle");
      toast.error(
        cause instanceof Error ? cause.message : "Couldn't add your logo."
      );
    }
  }

  return (
    <section className="rounded-xl border">
      <div className="flex items-center justify-between gap-3 px-5 pt-4 pb-1">
        <p className={EYEBROW}>While you&apos;re here</p>
        <Button
          variant="link"
          size="sm"
          className="text-muted-foreground h-auto p-0"
          onClick={onDismiss}
        >
          No thanks
        </Button>
      </div>

      {logo ? (
        logoState === "added" ? (
          <div className="flex items-start gap-3 border-t px-5 py-4 first-of-type:border-t-0">
            <Check className="mt-0.5 size-4 shrink-0" />
            <div>
              <p className="text-sm font-medium">
                Added — {first} sees it now.
              </p>
              <p className="text-muted-foreground mt-0.5 text-xs">
                The link updates itself. No resend, no second message.
              </p>
            </div>
          </div>
        ) : (
          <Offer
            title="Add your business logo"
            detail="Your logo appears on the shared quote."
            action={
              <>
                <input
                  ref={input}
                  type="file"
                  accept="image/png,image/jpeg,image/webp"
                  className="hidden"
                  onChange={upload}
                />
                <Button
                  size="sm"
                  variant="outline"
                  disabled={logoState === "uploading"}
                  onClick={() => input.current?.click()}
                >
                  {logoState === "uploading" ? (
                    <Loader2 className="animate-spin" />
                  ) : null}
                  Add
                </Button>
              </>
            }
          />
        )
      ) : null}

      {deposit ? (
        <Offer
          title={`Let ${first} pay the deposit`}
          detail={`Connect your payment account to accept deposits online. ${feeLine}`}
          action={
            <Button asChild size="sm" variant="outline">
              <Link href="/office/connections">Set up</Link>
            </Button>
          }
        />
      ) : null}

      <Offer
        title="Quote another job"
        detail="Your name and license are already on it."
        action={
          <Button asChild size="sm" variant="outline">
            <Link href="/quotes/new">Start</Link>
          </Button>
        }
      />
    </section>
  );
}

function Offer({
  title,
  detail,
  action,
}: {
  title: string;
  detail: string;
  action: ReactNode;
}) {
  return (
    <div className="flex items-center justify-between gap-4 border-t px-5 py-4 first-of-type:border-t-0">
      <div className="min-w-0">
        <p className="text-sm font-medium">{title}</p>
        <p className="text-muted-foreground mt-0.5 text-xs">{detail}</p>
      </div>
      <div className="shrink-0">{action}</div>
    </div>
  );
}

/**
 * 11d · gone quiet. Drafted for him, sent by him — it never sends itself,
 * because automation that messages customers behind his back costs more trust
 * than it saves time.
 */
function CheckIn({
  quoteId,
  first,
  customerEmail,
  emailEnabled,
  onSent,
}: {
  quoteId: string;
  first: string;
  customerEmail: string | null;
  emailEnabled: boolean;
  onSent: () => void;
}) {
  const [message, setMessage] = useState(
    `Hi ${first} — just making sure the quote came through OK. Happy to walk through anything on it.`
  );
  const [editing, setEditing] = useState(false);
  const [sending, setSending] = useState(false);

  const channel = emailEnabled && customerEmail ? "email" : "link";

  async function send() {
    setSending(true);
    try {
      const result = await api<{ url: string; to: string | null }>(
        `/api/v1/quotes/${quoteId}/send`,
        "POST",
        {
          channel,
          message: message.trim(),
          ...(channel === "email" ? { to: customerEmail } : {}),
        }
      );

      if (channel === "link") {
        await navigator.clipboard
          .writeText(`${message.trim()}\n\n${result.url}`)
          .catch(() => undefined);
        toast.success(`Copied — your message and the link, ready to send to ${first}.`);
      } else {
        toast.success(`Sent to ${result.to}.`);
      }
      onSent();
    } catch (cause) {
      toast.error(
        cause instanceof Error ? cause.message : "Nothing was sent. Try again."
      );
    } finally {
      setSending(false);
    }
  }

  return (
    <section className="border-l-foreground rounded-xl border border-l-4 p-5">
      <p className="font-semibold">Want to check in?</p>
      {editing ? (
        <Textarea
          className="mt-3"
          rows={3}
          value={message}
          onChange={(event) => setMessage(event.target.value)}
        />
      ) : (
        <p className="text-muted-foreground mt-2 text-sm leading-relaxed">
          {message}
        </p>
      )}
      <div className="mt-4 flex gap-2">
        <Button
          size="sm"
          onClick={send}
          disabled={sending || message.trim() === ""}
        >
          {sending ? <Loader2 className="animate-spin" /> : null}
          {channel === "email" ? "Send it" : "Copy it"}
        </Button>
        {editing ? null : (
          <Button size="sm" variant="ghost" onClick={() => setEditing(true)}>
            Edit
          </Button>
        )}
      </div>
    </section>
  );
}

/**
 * 15a · the demo close-out. A handoff, not a receipt — the only framed object
 * is the ask, and what was kept is said out loud so nothing is discovered later.
 */
function Handoff({ url }: { url: string | null }) {
  return (
    <div className="mx-auto flex w-full max-w-md flex-col gap-8 px-4 py-10 md:py-16">
      <div className="flex items-center gap-2">
        <p className={EYEBROW}>Sent to you</p>
        <DemoChip />
      </div>

      <div>
        <p className={EYEBROW}>Practice complete</p>
        <h1 className="mt-2 text-3xl leading-tight font-semibold tracking-tight text-balance">
          Your practice quote is ready to review.
        </h1>
        <p className="text-muted-foreground mt-3 leading-relaxed">
          You’ve created and sent a practice quote to yourself. Open it to see how your customers will review your work and prices.
        </p>
        {url ? (
          <Button asChild variant="outline" size="sm" className="mt-4">
            <a href={url} target="_blank" rel="noreferrer">
              <ExternalLink />
              View customer preview
            </a>
          </Button>
        ) : null}
      </div>

      <div>
        <p className={EYEBROW}>Saved in your account</p>
        <ul className="mt-2">
          <Kept label="The demo quote — in Quotes" tag="Labelled" />
          <Kept label="The demo job — in Jobs" tag="Labelled" />
          <Kept label="Your name and license — in the Office" tag="Real" />
        </ul>
      </div>

      <section className="bg-card rounded-xl border p-5 shadow-sm">
        <p className="text-lg font-semibold">Start a quote for your next customer</p>
        <p className="text-muted-foreground mt-1 text-sm leading-relaxed">
          Describe a job, set your prices, and send the quote when you’re ready.
        </p>
        <Button asChild size="lg" className="mt-4 w-full">
          <Link href="/welcome">Quote a real job</Link>
        </Button>
        <Button asChild variant="ghost" className="mt-2 w-full">
          <Link href="/dashboard">Go to dashboard</Link>
        </Button>
      </section>

      <p className="text-muted-foreground text-xs leading-relaxed">
        Practice quotes stay separate from your business totals.
      </p>
    </div>
  );
}

function Kept({ label, tag }: { label: string; tag: string }) {
  return (
    <li className="flex items-center justify-between gap-4 border-t py-3 text-sm first:border-t-0">
      <span>{label}</span>
      <span className="text-muted-foreground font-label text-[10px] uppercase">
        {tag}
      </span>
    </li>
  );
}

async function api<T>(path: string, method: string, body: unknown): Promise<T> {
  const response = await fetch(path, {
    method,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  }).catch(() => null);

  const json = (await response?.json().catch(() => null)) as {
    data?: T;
    error?: { message?: string };
  } | null;

  if (!response?.ok) {
    reportFreeLimit(json?.error);
    throw new Error(
      json?.error?.message ?? "Couldn't reach the server. Try again."
    );
  }
  return json?.data as T;
}

async function patchProfile(body: Record<string, true>) {
  await fetch("/api/v1/profile", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  }).catch(() => null);
}

function firstName(name: string) {
  return name.trim().split(/\s+/)[0] || "your customer";
}

function capitalize(value: string) {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

function plural(count: number, unit: string) {
  return `${count} ${unit}${count === 1 ? "" : "s"}`;
}

function openedTitle(count: number) {
  if (count <= 1) return "Opened";
  if (count === 2) return "Opened twice";
  return `Opened ${count} times`;
}

/**
 * "Today, 2:41 PM" · "Yesterday, 9:14 PM" · "Tuesday, 7:02 AM" · "Aug 3, 4:02
 * PM". Mid-sentence, the relative words drop their capital.
 */
function clock(iso: string | null, nowMs: number, midSentence = false) {
  if (!iso) return "";
  const date = new Date(iso);
  const now = new Date(nowMs);
  const time = date.toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
  });
  const startOfToday = new Date(
    now.getFullYear(),
    now.getMonth(),
    now.getDate()
  ).getTime();
  const at = date.getTime();

  const relative = (word: string) =>
    `${midSentence ? word.toLowerCase() : word}, ${time}`;

  if (at >= startOfToday) return relative("Today");
  if (at >= startOfToday - DAY) return relative("Yesterday");
  if (at >= startOfToday - 6 * DAY) {
    return `${date.toLocaleDateString("en-US", { weekday: "long" })}, ${time}`;
  }
  return `${date.toLocaleDateString("en-US", { month: "short", day: "numeric" })}, ${time}`;
}
