"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition, type ReactNode } from "react";
import { AlertTriangle, Check, ChevronDown, Loader2 } from "lucide-react";
import { toast } from "sonner";

import { ComingSoon } from "@/components/coming-soon";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import type { ConnectionRow } from "@/lib/queries/connections";
import { cn } from "@/lib/utils";

/**
 * One connector, with its health and the exact scope of what it does.
 *
 * ## The disclosure is the point of the card
 *
 * *"Will it mess up my books?"* is the question that decides whether a
 * contractor clicks Connect, and their accountant is a real purchase
 * influencer. So what this product reads and writes over there is stated **in
 * plain language before connecting**, on our page — not left to the provider's
 * consent screen, which lists API scopes and reassures nobody.
 *
 * ## Health is never silent
 *
 * A sync that stops landing without saying so corrupts books and trust. Three
 * states get three different treatments, because only one of them has an action
 * the contractor can take: `needs_reauth` asks them to reconnect, `degraded`
 * says we are retrying, `error` says it is ours.
 */
export function ConnectionCard({
  row,
  extra,
}: {
  row: ConnectionRow;
  /** Something this connector needs said up front — what card payments cost. */
  extra?: ReactNode;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [open, setOpen] = useState(false);

  const { connector, connection, availability } = row;
  const connected = connection !== null;
  const needsReauth = connection?.status === "needs_reauth";

  function disconnect() {
    startTransition(async () => {
      const response = await fetch(`/api/v1/connections/${connector.id}`, {
        method: "DELETE",
      });

      if (!response.ok) {
        const body = (await response.json().catch(() => null)) as {
          error?: { message?: string };
        } | null;
        toast.error(body?.error?.message ?? "Couldn't disconnect.");
        return;
      }

      toast.success(
        `${connector.name} disconnected. Nothing already sent over there was touched.`
      );
      router.refresh();
    });
  }

  return (
    <div
      className={cn(
        "@container/connection min-w-0 rounded-xl border p-5",
        needsReauth && "border-primary/60",
        connection?.status === "error" && "border-destructive/60"
      )}
    >
      <div className="flex flex-col gap-3 @xl/connection:flex-row @xl/connection:items-start @xl/connection:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap items-baseline gap-2">
            <h3 className="font-medium">{connector.name}</h3>
            <StatusBadge row={row} />
          </div>

          <p className="text-muted-foreground mt-1 text-sm">
            {connector.summary}
          </p>

          {connection?.accountName ? (
            <p className="text-muted-foreground mt-2 flex items-center gap-1.5 text-xs">
              <Check className="size-3.5" />
              {connection.accountName}
            </p>
          ) : null}

          {/* Plain language, and the reason is not decoration: an error a
              contractor cannot act on is one they raise a ticket about. */}
          {connection?.lastError ? (
            <p className="text-muted-foreground mt-2 flex items-start gap-1.5 text-xs">
              <AlertTriangle className="mt-px size-3.5 shrink-0" />
              {connection.lastError}
            </p>
          ) : null}

          {row.stuck > 0 ? (
            <p className="text-destructive mt-2 text-xs">
              {row.stuck} {row.stuck === 1 ? "record has" : "records have"}{" "}
              stopped trying. They&apos;ll go through once this is reconnected.
            </p>
          ) : row.pending > 0 ? (
            <p className="text-muted-foreground mt-2 text-xs">
              {row.pending} waiting to go over.
            </p>
          ) : null}
        </div>

        <div className="flex shrink-0 flex-wrap items-center gap-2">
          {availability === "planned" || availability === "unconfigured" ? (
            // Planned, or built and waiting on its keys: to the contractor
            // both are the same fact, and ours to fix — so one label, never
            // one that makes him wonder whether he did something wrong.
            <ComingSoon />
          ) : connected ? (
            <>
              {needsReauth ? (
                <Button asChild size="sm">
                  <a href={`/api/connections/${connector.id}/start`}>
                    {/* A hosted connector was never *connected* in the first
                        place — the platform created the account and the
                        contractor has paperwork left to finish. "Reconnect"
                        would tell him something broke that never worked yet. */}
                    {connector.handshake === "hosted"
                      ? "Finish setting up"
                      : "Reconnect"}
                  </a>
                </Button>
              ) : null}
              <Button
                variant="outline"
                size="sm"
                onClick={disconnect}
                disabled={pending}
              >
                {pending ? <Loader2 className="animate-spin" /> : null}
                Disconnect
              </Button>
            </>
          ) : (
            <Button asChild>
              <a href={`/api/connections/${connector.id}/start`}>
                {connector.handshake === "hosted" ? "Set up" : "Connect"}
              </a>
            </Button>
          )}
        </div>
      </div>

      {extra ? <div className="mt-4">{extra}</div> : null}

      {/* Before connecting, not after. */}
      <Collapsible open={open} onOpenChange={setOpen} className="mt-4">
        <CollapsibleTrigger className="text-muted-foreground hover:text-foreground flex items-center gap-1.5 text-xs">
          <ChevronDown
            className={cn("size-3.5 transition-transform", open && "rotate-180")}
          />
          What this can see, and what it changes
        </CollapsibleTrigger>

        <CollapsibleContent className="mt-3 grid gap-4 @md/connection:grid-cols-2">
          <Scope title="Reads" items={connector.reads} />
          <Scope title="Writes" items={connector.writes} />
        </CollapsibleContent>
      </Collapsible>
    </div>
  );
}

function Scope({ title, items }: { title: string; items: string[] }) {
  return (
    <div>
      <p className="text-muted-foreground font-label text-[10px] uppercase">
        {title}
      </p>
      <ul className="mt-1.5 flex flex-col gap-1.5">
        {items.map((item) => (
          <li key={item} className="text-muted-foreground text-xs leading-relaxed">
            {item}
          </li>
        ))}
      </ul>
    </div>
  );
}

/**
 * Health, said the way the contractor needs it.
 *
 * `needs_reauth` is separated from `error` because only one of them has an
 * action attached, and a surface that cannot tell them apart makes every
 * problem look like ours or like theirs.
 */
function StatusBadge({ row }: { row: ConnectionRow }) {
  if (!row.connection) return null;

  switch (row.connection.status) {
    case "connected":
      return <Badge variant="secondary">Connected</Badge>;
    case "needs_reauth":
      // A hosted account was never connected — its setup is unfinished.
      return (
        <Badge>
          {row.connector.handshake === "hosted"
            ? "Setup not finished"
            : "Needs reconnecting"}
        </Badge>
      );
    case "degraded":
      return (
        <Badge variant="outline">
          {row.connector.handshake === "hosted" ? "Verifying" : "Retrying"}
        </Badge>
      );
    case "error":
      return <Badge variant="destructive">Not working</Badge>;
    case "revoked":
      return <Badge variant="outline">Disconnected</Badge>;
  }
}
