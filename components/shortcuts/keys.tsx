"use client";

import { useSyncExternalStore } from "react";

import { Kbd, KbdGroup } from "@/components/ui/kbd";
import type { KeyName } from "@/lib/shortcuts";
import { cn } from "@/lib/utils";

const MAC: Record<string, string> = {
  Mod: "⌘",
  Alt: "⌥",
  Shift: "⇧",
  Enter: "↵",
  Backspace: "⌫",
};

const OTHER: Record<string, string> = {
  Mod: "Ctrl",
  Alt: "Alt",
  Shift: "Shift",
  Enter: "Enter",
  Backspace: "Backspace",
};

const ARROWS: Record<string, string> = {
  ArrowUp: "↑",
  ArrowDown: "↓",
  Escape: "Esc",
};

function detectMac() {
  return /mac|iphone|ipad/i.test(navigator.userAgent);
}

/**
 * Whether to draw ⌘ and ⌥ or Ctrl and Alt. The server can't know, so it draws
 * the non-Mac names and the client corrects them after hydrating.
 */
export function useIsMac(): boolean {
  return useSyncExternalStore(
    () => () => {},
    detectMac,
    () => false
  );
}

export function keyLabel(key: KeyName, mac: boolean): string {
  return ARROWS[key] ?? (mac ? MAC : OTHER)[key] ?? key;
}

/** A shortcut drawn as keycaps — `["Mod", "S"]` is ⌘ S on a Mac, Ctrl S elsewhere. */
export function Keys({
  keys,
  className,
}: {
  keys: KeyName[];
  className?: string;
}) {
  const mac = useIsMac();

  return (
    <KbdGroup className={className}>
      {keys.map((key) => (
        <Kbd key={key}>{keyLabel(key, mac)}</Kbd>
      ))}
    </KbdGroup>
  );
}

/** "G then Q" — keys pressed one after another. */
export function KeySequence({
  keys,
  className,
}: {
  keys: KeyName[];
  className?: string;
}) {
  const mac = useIsMac();

  return (
    <span className={cn("inline-flex items-center gap-1", className)}>
      {keys.map((key, index) => (
        <span key={`${key}-${index}`} className="inline-flex items-center gap-1">
          {index > 0 ? (
            <span className="text-muted-foreground text-xs">then</span>
          ) : null}
          <Kbd>{keyLabel(key, mac)}</Kbd>
        </span>
      ))}
    </span>
  );
}
