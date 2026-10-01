import type { Metadata } from "next";
import Link from "next/link";
import { sql } from "drizzle-orm";

import { requireAdmin } from "@/lib/admin/access";
import { db } from "@/lib/db";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "Event log" };

const LEVELS = ["money", "milestone", "problem", "activity"] as const;
const PAGE = 100;

/**
 * The whole event log, searchable and paged — what the live feed has scrolled
 * past, and the audit trail of every admin action.
 *
 * `?q` searches titles and businesses, `?kind` narrows to one kind (a prefix:
 * "subscription" finds all of them), `?level` to one level, `?test=1` includes
 * the check scripts' shops, and `?before` pages back.
 */
export default async function EventsPage({ searchParams }: PageProps<"/admin/events">) {
  await requireAdmin();
  const params = await searchParams;
  const one = (key: string) => (typeof params[key] === "string" ? (params[key] as string).slice(0, 100) : "");
  const q = one("q");
  const kind = one("kind");
  const level = LEVELS.find((entry) => entry === one("level")) ?? "";
  const test = one("test") === "1";
  const before = Number(one("before")) || null;

  const like = q ? `%${q.replace(/[%_\\]/g, "\\$&")}%` : null;
  const rows = [
    ...(await db.execute<{
      id: string;
      occurred_at: string;
      kind: string;
      level: string;
      title: string;
      org_name: string | null;
      amount_cents: string | null;
      test: boolean;
      demo: boolean;
      data: Record<string, unknown>;
    }>(sql`
      select id, occurred_at, kind, level, title, org_name, amount_cents::text, test, demo, data
      from admin_events
      where (${test} or not test)
        and (${like}::text is null or title ilike ${like} or org_name ilike ${like})
        and (${kind} = '' or kind like ${`${kind}%`})
        and (${level} = '' or level = ${level})
        and (${before}::bigint is null or id < ${before})
      order by id desc
      limit ${PAGE}
    `)),
  ];
  const kinds = [...(await db.execute<{ kind: string; n: number }>(sql`select kind, count(*)::int as n from admin_events group by 1 order by 2 desc`))];

  const href = (change: Record<string, string | null>) => {
    const next = new URLSearchParams(
      Object.entries({ q, kind, level, test: test ? "1" : "" }).filter((entry): entry is [string, string] => Boolean(entry[1]))
    );
    for (const [key, value] of Object.entries(change)) {
      if (value) next.set(key, value);
      else next.delete(key);
    }
    return `/admin/events${next.size ? `?${next}` : ""}`;
  };

  return (
    <div className="flex flex-col gap-4 p-3 md:p-5">
      <div className="flex flex-wrap items-baseline gap-3">
        <h1 className="text-xl font-semibold tracking-tight">Event log</h1>
        <span className="text-muted-foreground text-sm">Everything the database has logged, newest first — including every admin action.</span>
      </div>

      <form className="flex flex-wrap items-center gap-2 text-sm" action="/admin/events">
        <input
          name="q"
          defaultValue={q}
          aria-label="Search the log"
          placeholder="Search titles and businesses"
          className="bg-background h-8 min-w-56 rounded-md border border-input px-2.5"
        />
        <select name="kind" defaultValue={kind} aria-label="Kind" className="bg-background h-8 rounded-md border border-input px-2">
          <option value="">Every kind</option>
          {kinds.map((entry) => (
            <option key={entry.kind} value={entry.kind}>
              {entry.kind} ({entry.n})
            </option>
          ))}
        </select>
        <select name="level" defaultValue={level} aria-label="Level" className="bg-background h-8 rounded-md border border-input px-2">
          <option value="">Every level</option>
          {LEVELS.map((entry) => (
            <option key={entry} value={entry}>
              {entry}
            </option>
          ))}
        </select>
        <label className="text-muted-foreground flex items-center gap-1.5">
          <input type="checkbox" name="test" value="1" defaultChecked={test} />
          Include test shops
        </label>
        <button type="submit" className="bg-primary text-primary-foreground h-8 rounded-md px-3 font-medium">
          Show
        </button>
        {q || kind || level || test ? (
          <Link href="/admin/events" className="text-muted-foreground hover:text-foreground">
            Clear
          </Link>
        ) : null}
      </form>

      <div className="bg-card overflow-x-auto rounded-lg border">
        <table className="w-full text-xs">
          <thead className="text-muted-foreground text-left">
            <tr>
              {["#", "When", "Level", "Kind", "What", "Business", "Amount", "Details"].map((head) => (
                <th key={head} className="px-3 py-2 font-normal whitespace-nowrap">{head}</th>
              ))}
            </tr>
          </thead>
          <tbody className="tabular-nums">
            {rows.length === 0 ? (
              <tr>
                <td colSpan={8} className="text-muted-foreground px-3 py-8 text-center">Nothing logged matches that.</td>
              </tr>
            ) : (
              rows.map((row) => (
                <tr key={row.id} className={cn("border-t align-top", (row.test || row.demo) && "opacity-60")}>
                  <td className="text-muted-foreground px-3 py-1.5">{row.id}</td>
                  <td className="px-3 py-1.5 whitespace-nowrap">
                    {new Date(row.occurred_at).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit", second: "2-digit" })}
                  </td>
                  <td className="px-3 py-1.5">
                    <span
                      className={cn(
                        "rounded px-1.5 py-0.5",
                        row.level === "money" && "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400",
                        row.level === "milestone" && "bg-sky-500/15 text-sky-600 dark:text-sky-400",
                        row.level === "problem" && "bg-destructive/15 text-destructive",
                        row.level === "activity" && "bg-muted text-muted-foreground"
                      )}
                    >
                      {row.level}
                    </span>
                  </td>
                  <td className="px-3 py-1.5 whitespace-nowrap">
                    <Link href={href({ kind: row.kind, before: null })} className="hover:underline">{row.kind}</Link>
                  </td>
                  <td className="min-w-72 px-3 py-1.5">
                    {row.title}
                    {row.test ? <span className="text-muted-foreground"> · test</span> : null}
                    {row.demo ? <span className="text-muted-foreground"> · demo</span> : null}
                  </td>
                  <td className="px-3 py-1.5 whitespace-nowrap">{row.org_name ?? "—"}</td>
                  <td className="px-3 py-1.5 whitespace-nowrap">
                    {row.amount_cents ? `$${(Number(row.amount_cents) / 100).toLocaleString("en-US", { minimumFractionDigits: 2 })}` : ""}
                  </td>
                  <td className="text-muted-foreground max-w-80 px-3 py-1.5 font-mono text-[10px] break-all">
                    {Object.keys(row.data ?? {}).length ? JSON.stringify(row.data) : ""}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {rows.length === PAGE ? (
        <Link href={href({ before: rows[rows.length - 1].id })} className="text-muted-foreground hover:text-foreground self-start text-sm underline underline-offset-4">
          Older
        </Link>
      ) : null}
    </div>
  );
}
