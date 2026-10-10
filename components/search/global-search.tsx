"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useInfiniteQuery, useIsFetching } from "@tanstack/react-query";
import { Loader2, Maximize2, Search } from "lucide-react";
import { Command as CommandPrimitive } from "cmdk";

import { DemoChip } from "@/components/demo-chip";
import { Button } from "@/components/ui/button";
import {
  Command,
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import {
  KIND_LABELS,
  SEARCH_KINDS,
  type SearchHit,
  type SearchKind,
  type SearchPage,
} from "@/lib/search/kinds";
import { isPlainKey, isTypingTarget } from "@/lib/shortcuts";

/**
 * One search over everything the shop has, in two shapes that share a mind.
 *
 * **The header field is the search.** You type where the box is and the
 * results fall open underneath it — nothing jumps, nothing takes the screen,
 * and looking something up costs no more than glancing at it. A palette that
 * leaps to the middle of the screen and asks you to type again is a second box
 * for the same sentence.
 *
 * **The palette is that same search, given the room.** ⌘K opens it from
 * anywhere carrying whatever is already typed, and closing it hands the words
 * back — so the quick look and the long hunt are one continuous act rather
 * than two features. On a phone, where a 34rem field in a 56px header is a
 * fiction, the palette is the only shape.
 *
 * **Grouped, because a contractor searches for a person, not an object type.**
 * "Petersen" is a customer, two jobs and an unpaid invoice; the answer is all
 * of them, in piles they can scan. Each group pages itself as it is scrolled,
 * so two hundred matching invoices never bury the one matching customer.
 */
export function GlobalSearch() {
  const [term, setTerm] = useState("");
  const [query, setQuery] = useState("");
  const [dropdown, setDropdown] = useState(false);
  const [palette, setPalette] = useState(false);
  const field = useRef<HTMLDivElement>(null);

  // Typing is not a search. A quarter-second after the last keystroke is —
  // which is the difference between six queries and sixty.
  useEffect(() => {
    const timer = setTimeout(() => setQuery(term.trim()), 250);
    return () => clearTimeout(timer);
  }, [term]);

  // ⌘K anywhere. From the header field it means "give me room", which is why
  // the words go with it rather than starting again.
  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key === "k" && (event.metaKey || event.ctrlKey)) {
        event.preventDefault();
        setDropdown(false);
        setPalette((open) => !open);
        return;
      }

      // `/` puts the cursor in the header field, or opens the palette where
      // there is no field. A page with its own `/` (Tasks) handles it first.
      if (
        event.key === "/" &&
        !event.defaultPrevented &&
        isPlainKey(event) &&
        !isTypingTarget(event.target)
      ) {
        event.preventDefault();
        const input = field.current?.querySelector("input");
        if (input && input.offsetParent !== null) input.focus();
        else setPalette(true);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // A press anywhere else puts the dropdown away. Not `blur`: clicking a
  // result blurs the input, and closing before the click lands eats the click.
  useEffect(() => {
    if (!dropdown) return;
    function onDown(event: PointerEvent) {
      if (!field.current?.contains(event.target as Node)) setDropdown(false);
    }
    document.addEventListener("pointerdown", onDown);
    return () => document.removeEventListener("pointerdown", onDown);
  }, [dropdown]);

  function done() {
    setDropdown(false);
    setPalette(false);
    setTerm("");
    setQuery("");
  }

  const dropped = dropdown && term.trim().length > 0;

  return (
    <>
      {/* Centred on the *header*, not on whatever the breadcrumb and the
          actions leave over — which is why it is taken out of the flow. */}
      <div
        ref={field}
        className="absolute top-1/2 left-1/2 hidden w-[calc(100%-24rem)] max-w-[34rem] -translate-x-1/2 -translate-y-1/2 px-4 md:block"
      >
        <Command
          shouldFilter={false}
          className="overflow-visible bg-transparent p-0"
          // Escape closes the results but leaves the words — the next keystroke
          // carries on rather than starting over.
          onKeyDown={(event) => {
            if (event.key === "Escape") setDropdown(false);
          }}
        >
          <div className="border-input bg-muted/40 focus-within:border-ring focus-within:ring-ring/25 flex h-10 items-center gap-2 rounded-lg border px-3 shadow-xs transition-colors focus-within:bg-background focus-within:ring-2">
            <Search aria-hidden="true" className="text-muted-foreground size-4 shrink-0" />
            <CommandPrimitive.Input
              aria-label="Search jobs, quotes, customers and invoices"
              className="placeholder:text-muted-foreground min-w-0 flex-1 bg-transparent text-sm outline-none"
              value={term}
              onValueChange={(value) => {
                setTerm(value);
                setDropdown(true);
              }}
              onFocus={() => setDropdown(true)}
              placeholder="Search jobs, quotes, customers, invoices…"
            />
            <button
              type="button"
              onClick={() => {
                setDropdown(false);
                setPalette(true);
              }}
              title="Open the full search (⌘K)"
              className="text-muted-foreground hover:text-foreground hover:bg-muted focus-visible:ring-ring -mr-1 flex size-8 shrink-0 items-center justify-center rounded-md outline-none focus-visible:ring-2"
            >
              <Maximize2 aria-hidden="true" className="size-4" />
              <span className="sr-only">Open the full search</span>
            </button>
          </div>

          {dropped ? (
            <div className="bg-popover ring-foreground/10 absolute top-full right-4 left-4 z-50 mt-1.5 overflow-hidden rounded-lg shadow-md ring-1">
              <CommandList className="max-h-[70vh]">
                <Results query={query} onDone={done} />
              </CommandList>
            </div>
          ) : null}
        </Command>
      </div>

      {/* The phone's only shape. */}
      <Button
        variant="ghost"
        size="icon"
        aria-label="Search"
        onClick={() => setPalette(true)}
        className="md:hidden"
      >
        <Search className="size-4" />
      </Button>

      <CommandDialog
        open={palette}
        onOpenChange={(next) => {
          setPalette(next);
          if (!next) setDropdown(false);
        }}
        title="Search"
        description="Jobs, quotes, contracts, change orders, invoices and customers."
        className="sm:max-w-2xl"
      >
        <Command shouldFilter={false}>
          <CommandInput
            value={term}
            onValueChange={setTerm}
            placeholder="Search everything — a name, a number, an address"
            autoFocus
          />
          <CommandList className="max-h-[60vh]">
            {term.trim().length === 0 ? (
              <p className="text-muted-foreground px-4 py-6 text-center text-sm">
                Jobs, quotes, contracts, change orders, invoices and customers —
                all at once.
              </p>
            ) : (
              <Results query={query} onDone={done} />
            )}
          </CommandList>
        </Command>
      </CommandDialog>
    </>
  );
}

function Results({ query, onDone }: { query: string; onDone: () => void }) {
  // Every search query in flight, whichever group it belongs to. Saves the
  // groups reporting up to a parent that would then re-render all of them.
  const searching = useIsFetching({ queryKey: ["search", query] }) > 0;

  if (query.length === 0) return null;

  return (
    <>
      {SEARCH_KINDS.map((kind) => (
        <Group key={kind} kind={kind} query={query} onDone={onDone} />
      ))}

      {/* cmdk shows this only when no group rendered a row. Held back while
          anything is still in flight, so an empty half-second doesn't read as
          "nothing matches". */}
      {searching ? (
        <p className="text-muted-foreground flex items-center justify-center gap-2 px-4 py-6 text-sm">
          <Loader2 className="size-3.5 animate-spin" />
          Searching…
        </p>
      ) : (
        <CommandEmpty>Nothing matches that.</CommandEmpty>
      )}
    </>
  );
}

type Answer = { groups: SearchPage[] };

function Group({
  kind,
  query,
  onDone,
}: {
  kind: SearchKind;
  query: string;
  onDone: () => void;
}) {
  const router = useRouter();

  const { data, fetchNextPage, hasNextPage, isFetchingNextPage } =
    useInfiniteQuery({
      queryKey: ["search", query, kind],
      initialPageParam: 0,
      queryFn: async ({ pageParam, signal }) => {
        const params = new URLSearchParams({
          q: query,
          kind,
          limit: "5",
          offset: String(pageParam),
        });
        const response = await fetch(`/api/v1/search?${params}`, { signal });
        if (!response.ok) throw new Error("That search didn't come back.");
        const body = (await response.json()) as { data: Answer };
        return body.data.groups[0];
      },
      getNextPageParam: (last) =>
        last.hasMore ? last.offset + last.hits.length : undefined,
    });

  const hits = data?.pages.flatMap((page) => page.hits) ?? [];
  if (hits.length === 0) return null;

  return (
    <CommandGroup heading={KIND_LABELS[kind]}>
      {hits.map((hit) => (
        <Hit
          key={hit.id}
          hit={hit}
          onSelect={() => {
            onDone();
            router.push(hit.href);
          }}
        />
      ))}

      {hasNextPage ? (
        <Sentinel
          onReach={fetchNextPage}
          busy={isFetchingNextPage}
          label={KIND_LABELS[kind].toLowerCase()}
        />
      ) : null}
    </CommandGroup>
  );
}

function Hit({ hit, onSelect }: { hit: SearchHit; onSelect: () => void }) {
  return (
    <CommandItem value={`${hit.kind}:${hit.id}`} onSelect={onSelect}>
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="flex items-center gap-2">
          <span className="truncate">{hit.title}</span>
          {hit.demo ? <DemoChip /> : null}
        </span>
        {hit.detail ? (
          <span className="text-muted-foreground truncate text-xs">
            {hit.detail}
          </span>
        ) : null}
      </span>
      {hit.meta ? (
        <span className="text-muted-foreground ml-auto shrink-0 text-xs capitalize tabular-nums">
          {hit.meta}
        </span>
      ) : null}
    </CommandItem>
  );
}

/**
 * The end of a group. While it is on screen, that group keeps asking for more
 * — which is the whole of the infinite list.
 *
 * **Watching "is it in view", not "did it come into view".** An observer fires
 * on the crossing, so a sentinel that is still visible after a page lands
 * never fires again and the list stops one page in. Holding the state and
 * reacting to it is what makes the next page arrive.
 */
function Sentinel({
  onReach,
  busy,
  label,
}: {
  onReach: () => void;
  busy: boolean;
  label: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [inView, setInView] = useState(false);

  useEffect(() => {
    const node = ref.current;
    if (!node) return;

    const observer = new IntersectionObserver(
      (entries) => {
        // From the observer's own callback, never during a render.
        setInView(entries.some((entry) => entry.isIntersecting));
      },
      {
        root: node.closest("[data-slot=command-list]"),
        // A little early, so the next five are there by the time they're wanted.
        rootMargin: "120px",
      }
    );

    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (inView && !busy) onReach();
  }, [inView, busy, onReach]);

  return (
    <div
      ref={ref}
      aria-hidden
      className="text-muted-foreground flex items-center gap-2 px-2 py-2 text-xs"
    >
      {busy ? <Loader2 className="size-3 animate-spin" /> : null}
      More {label}…
    </div>
  );
}
