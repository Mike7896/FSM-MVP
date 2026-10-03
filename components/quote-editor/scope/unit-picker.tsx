"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Check, ChevronDown, Plus } from "lucide-react";

import {
  Command,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
} from "@/components/ui/command";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  UNIT_GROUPS,
  UNITS_FOR_BUCKET,
  bucketLabel,
  unitOption,
  type LineSection,
} from "@/lib/quote";
import { cn } from "@/lib/utils";

/** The units this Office has made up before. Quietly empty when there's no Office yet. */
function useOfficeUnits(): string[] {
  const { data } = useQuery({
    queryKey: ["office-units"],
    queryFn: async () => {
      const response = await fetch("/api/v1/units");
      if (!response.ok) return [];
      const body = (await response.json()) as { data?: { units?: string[] } };
      return body.data?.units ?? [];
    },
    staleTime: 5 * 60 * 1000,
  });
  return data ?? [];
}

/**
 * The unit on a priced row — a short list for the row's cost category, every
 * common unit underneath, and whatever he types if it isn't there. A unit he
 * makes up is offered again on his next quote.
 */
export function UnitPicker({
  value,
  section,
  onChange,
}: {
  value: string | null;
  section: LineSection | null;
  onChange: (unit: string | null) => void;
}) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const yours = useOfficeUnits();

  const typed = search.trim();
  // "Gal" is the gallon in the list, so it's the one that gets the tick.
  const current = value ? (unitOption(value)?.value ?? value) : null;
  const usual = section ? UNITS_FOR_BUCKET[section] : [];
  const known = new Set([
    ...UNIT_GROUPS.flatMap((group) => group.units.map((unit) => unit.value)),
    ...yours,
  ]);
  const canAdd = typed !== "" && !known.has(typed) && unitOption(typed) === null;

  function pick(unit: string | null) {
    onChange(unit);
    setOpen(false);
    setSearch("");
  }

  function item(unit: string, group: string, name?: string) {
    return (
      <CommandItem
        key={`${group}:${unit}`}
        value={`${group}:${unit} ${name ?? ""}`}
        onSelect={() => pick(unit)}
      >
        <span className="w-12 shrink-0 font-medium">{unit}</span>
        {name && name !== unit ? (
          <span className="text-muted-foreground min-w-0 truncate">{name}</span>
        ) : null}
        <Check
          className={cn("ml-auto size-3.5", current === unit ? "opacity-100" : "opacity-0")}
        />
      </CommandItem>
    );
  }

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) setSearch("");
      }}
    >
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label="Unit"
          className={cn(
            "border-input bg-background hover:border-muted-foreground focus-visible:border-ring focus-visible:ring-ring/30",
            "flex h-[31px] w-20 shrink-0 items-center justify-between gap-1 rounded-md border px-2 text-xs transition-colors outline-none focus-visible:ring-3",
            !value && "text-muted-foreground"
          )}
        >
          <span className="truncate">{value || "unit"}</span>
          <ChevronDown className="size-3 shrink-0 opacity-60" />
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-64 p-0">
        <Command>
          <CommandInput
            value={search}
            onValueChange={setSearch}
            placeholder="Find or type a unit"
          />
          <CommandList className="max-h-72">
            {canAdd ? (
              <CommandGroup>
                <CommandItem value={`add:${typed}`} onSelect={() => pick(typed)}>
                  <Plus className="size-3.5" />
                  Use “{typed}”
                </CommandItem>
              </CommandGroup>
            ) : null}

            {usual.length ? (
              <CommandGroup heading={`Usual for ${bucketLabel(section).toLowerCase()}`}>
                {usual.map((unit) => item(unit, "usual", unitOption(unit)?.name))}
              </CommandGroup>
            ) : null}

            {yours.length ? (
              <CommandGroup heading="Yours">
                {yours.map((unit) => item(unit, "yours"))}
              </CommandGroup>
            ) : null}

            <CommandSeparator />

            {UNIT_GROUPS.map((group) => (
              <CommandGroup key={group.label} heading={group.label}>
                {group.units.map((unit) => item(unit.value, group.label, unit.name))}
              </CommandGroup>
            ))}

            {value ? (
              <CommandGroup>
                <CommandItem value="clear:no unit" onSelect={() => pick(null)}>
                  <span className="text-muted-foreground">No unit</span>
                </CommandItem>
              </CommandGroup>
            ) : null}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
