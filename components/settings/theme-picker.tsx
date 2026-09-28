"use client";

import { useSyncExternalStore } from "react";
import { useTheme } from "next-themes";
import { Monitor, Moon, Sun } from "lucide-react";

import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Skeleton } from "@/components/ui/skeleton";

/**
 * How the app looks to this person — Settings, not the Office.
 *
 * **Three options rather than a two-way switch.** *System* is the one most
 * people actually want, and a binary toggle silently opts them out of it the
 * first time they touch it. It is also the honest default: the app has no
 * opinion about the light in someone's truck at 4pm.
 *
 * **It saves the moment it is chosen, with no Save button**, which is the one
 * place this wing departs from the rest of it. Everywhere else here a change
 * governs future documents and deserves a review step; this one is visible the
 * instant it lands, so confirming it would be asking about something already
 * on screen.
 *
 * The preference is the browser's, per device. There is nothing to store on the
 * Office — a contractor who prefers dark on the truck laptop and light at the
 * desk is not in conflict with themselves.
 */

const OPTIONS = [
  {
    value: "light",
    label: "Light",
    icon: Sun,
    note: "What most screens are set to.",
  },
  {
    value: "dark",
    label: "Dark",
    icon: Moon,
    note: "Easier at night and in a dim basement.",
  },
  {
    value: "system",
    label: "Match my device",
    icon: Monitor,
    note: "Follows whatever your phone or laptop is doing.",
  },
] as const;

export function ThemePicker() {
  const { theme, setTheme } = useTheme();

  // The server has no idea what the browser's system preference is, so reading
  // `theme` during the first client render is a hydration mismatch. This is the
  // hook built for exactly that question — it answers `false` on the server and
  // in the hydrating render, then `true` — so the skeleton renders identically
  // on both sides and no state is set from an effect to get there.
  const hydrated = useSyncExternalStore(
    subscribeToNothing,
    () => true,
    () => false
  );

  if (!hydrated) {
    return (
      <div className="flex flex-col gap-3">
        {OPTIONS.map((option) => (
          <Skeleton key={option.value} className="h-[68px] rounded-lg" />
        ))}
      </div>
    );
  }

  return (
    <RadioGroup
      value={theme ?? "system"}
      onValueChange={setTheme}
      className="gap-3"
    >
      {OPTIONS.map((option) => (
        <Label
          key={option.value}
          className="hover:bg-muted/50 flex cursor-pointer items-start gap-3 rounded-lg border p-4 font-normal"
        >
          <RadioGroupItem value={option.value} className="mt-0.5" />
          <option.icon className="text-muted-foreground mt-0.5 size-4 shrink-0" />
          <span className="flex-1">
            <span className="block font-medium">{option.label}</span>
            <span className="text-muted-foreground text-sm">{option.note}</span>
          </span>
        </Label>
      ))}
    </RadioGroup>
  );
}

/** Nothing to subscribe to: the value never changes after hydration. */
function subscribeToNothing() {
  return () => {};
}
