"use client";

import { useEffect, useState } from "react";
import { ChevronsUpDown, Plus } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import type { CustomerListItem } from "@/lib/queries/customers";

/** Who the work is for: someone in the directory, or a name that isn't yet. */
export type PickedCustomer = {
  /** Null for a name typed here that becomes a new customer on save. */
  id: string | null;
  name: string;
  address: string | null;
};

/**
 * The customer on a new job — find them, or add them by name.
 *
 * **Searches the shop's own directory**, most recent work first, through the
 * same customers endpoint the native app uses. Practice customers from the
 * demo are left out: real work never lands on them.
 *
 * **Adding someone new is offered only when nobody has that exact name**, so
 * the same person can't be added twice by accident — the rule the server
 * applies too.
 */
export function CustomerPicker({
  id,
  value,
  onChange,
  invalid,
}: {
  id?: string;
  value: PickedCustomer | null;
  onChange: (customer: PickedCustomer) => void;
  invalid?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<CustomerListItem[] | null>(null);

  useEffect(() => {
    if (!open) return;

    const controller = new AbortController();
    const term = query.trim();
    // Short pause so a search runs once a word is typed, not once per letter.
    const timer = setTimeout(async () => {
      const params = new URLSearchParams({ limit: "8" });
      if (term) params.set("q", term);
      try {
        const response = await fetch(`/api/v1/customers?${params}`, {
          signal: controller.signal,
        });
        if (!response.ok) return;
        const body = (await response.json()) as { data: CustomerListItem[] };
        setResults(body.data.filter((customer) => !customer.demo));
      } catch {
        // Aborted by the next keystroke, or offline — the list just doesn't
        // update, and typing a new name still works.
      }
    }, 200);

    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [open, query]);

  const typed = query.trim();
  const exactMatch = results?.some(
    (customer) => customer.name.toLowerCase() === typed.toLowerCase()
  );

  function pick(customer: PickedCustomer) {
    onChange(customer);
    setOpen(false);
    setQuery("");
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          id={id}
          type="button"
          variant="outline"
          role="combobox"
          aria-expanded={open}
          aria-invalid={invalid || undefined}
          className="border-input dark:border-input w-full justify-between font-normal"
        >
          {value ? (
            <span className="truncate">
              {value.name}
              {value.id === null ? (
                <span className="text-muted-foreground"> · new customer</span>
              ) : null}
            </span>
          ) : (
            <span className="text-muted-foreground">Who is the work for?</span>
          )}
          <ChevronsUpDown className="opacity-50" />
        </Button>
      </PopoverTrigger>

      <PopoverContent
        align="start"
        className="w-(--radix-popover-trigger-width) min-w-64 p-0"
      >
        {/* Filtering happens on the server, so cmdk's own is switched off. */}
        <Command shouldFilter={false}>
          <CommandInput
            value={query}
            onValueChange={setQuery}
            placeholder="Search, or type a new name"
          />
          <CommandList>
            <CommandEmpty>
              {results === null
                ? "Looking…"
                : "No customers yet. Type a name to add one."}
            </CommandEmpty>

            {results?.length ? (
              <CommandGroup>
                {results.map((customer) => (
                  <CommandItem
                    key={customer.id}
                    value={customer.id}
                    data-checked={value?.id === customer.id}
                    onSelect={() =>
                      pick({
                        id: customer.id,
                        name: customer.name,
                        address: customer.address,
                      })
                    }
                  >
                    <span className="min-w-0">
                      <span className="block truncate">{customer.name}</span>
                      {customer.address ? (
                        <span className="text-muted-foreground block truncate text-xs">
                          {customer.address}
                        </span>
                      ) : null}
                    </span>
                  </CommandItem>
                ))}
              </CommandGroup>
            ) : null}

            {typed && !exactMatch ? (
              <CommandGroup>
                <CommandItem
                  value="__new__"
                  onSelect={() => pick({ id: null, name: typed, address: null })}
                >
                  <Plus />
                  <span className="truncate">
                    Add <strong className="font-medium">{typed}</strong> as a
                    new customer
                  </span>
                </CommandItem>
              </CommandGroup>
            ) : null}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
