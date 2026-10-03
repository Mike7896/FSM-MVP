"use client";

import { Loader2 } from "lucide-react";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";

/**
 * The foot of a settings form that saves on a button. (Business identity and
 * document branding save themselves instead — see `SaveStatus`.)
 *
 * Save stays enabled until there is nothing to save. A disabled primary button
 * makes a contractor hunt for the field he has not filled in, so validation
 * speaks on submit rather than by greying the way out.
 */
export function SaveBar({
  dirty,
  pending,
  error,
  label = "Save",
  note,
}: {
  dirty: boolean;
  pending: boolean;
  error?: string | null;
  label?: string;
  /** What saving actually does, where that is not obvious. */
  note?: string;
}) {
  return (
    <div className="@container/save flex min-w-0 flex-col gap-3">
      {error ? (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}

      <div className="flex flex-col items-start gap-3 @sm/save:flex-row @sm/save:items-center @sm/save:justify-between @sm/save:gap-4">
        <p className="text-muted-foreground text-sm">
          {note ?? (dirty ? "Unsaved changes." : "Everything is saved.")}
        </p>
        <Button type="submit" disabled={pending || !dirty}>
          {pending ? <Loader2 className="animate-spin" /> : null}
          {label}
        </Button>
      </div>
    </div>
  );
}
