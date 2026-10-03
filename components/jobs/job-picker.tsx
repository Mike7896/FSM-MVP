"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Check, ChevronsUpDown, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import type { ScheduleJob } from "@/lib/schedule/types";
import { cn } from "@/lib/utils";

/**
 * Search the shop's jobs and pick one — the visit sheet's and the task
 * panel's. **The job is picked, never typed**: a thing on a job belongs to that
 * job, and a free-text "Miller kitchen" that matches nothing is a thing the
 * job's page can never find.
 */
export function JobPicker({
  value,
  onChange,
  clearable = false,
  emptyLabel,
  clearLabel = "No job — it's the shop's",
  className,
}: {
  value: ScheduleJob | null;
  onChange: (job: ScheduleJob | null) => void;
  /** Offer "No job" — for things that can belong to the shop instead. */
  clearable?: boolean;
  /** What the button says with nothing picked. */
  emptyLabel?: string;
  /** What the "none" choice says, when there is one. */
  clearLabel?: string;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");

  const jobs = useQuery({
    queryKey: ["schedule-jobs", query],
    queryFn: async (): Promise<ScheduleJob[]> => {
      const response = await fetch(
        `/api/v1/schedule/jobs?${new URLSearchParams(query ? { q: query } : {})}`
      );
      const body = (await response.json().catch(() => null)) as { data?: ScheduleJob[] } | null;
      return body?.data ?? [];
    },
    enabled: open,
    staleTime: 30_000,
    placeholderData: (previous) => previous,
  });

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          role="combobox"
          aria-expanded={open}
          className={cn("border-input dark:border-input h-auto min-h-9 justify-between py-1.5 text-left font-normal", className)}
        >
          {value ? (
            <span className="min-w-0">
              <span className="block truncate">{jobLabel(value)}</span>
              {value.address ? (
                <span className="text-muted-foreground block truncate text-xs">{value.address}</span>
              ) : null}
            </span>
          ) : (
            <span className="text-muted-foreground">{emptyLabel ?? (clearable ? "No job" : "Pick a job")}</span>
          )}
          <ChevronsUpDown className="text-muted-foreground size-4 shrink-0" />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-[max(var(--radix-popover-trigger-width),18rem)] p-0">
        <Command shouldFilter={false}>
          <CommandInput value={query} onValueChange={setQuery} placeholder="Customer, job or address" />
          <CommandList>
            <CommandEmpty>{jobs.isFetching ? "Looking…" : "No job matches that."}</CommandEmpty>
            <CommandGroup>
              {clearable && value ? (
                <CommandItem
                  value="__none"
                  onSelect={() => {
                    onChange(null);
                    setOpen(false);
                  }}
                >
                  <X className="size-4" />
                  {clearLabel}
                </CommandItem>
              ) : null}
              {(jobs.data ?? []).map((job) => (
                <CommandItem
                  key={job.id}
                  value={job.id}
                  onSelect={() => {
                    onChange(job);
                    setOpen(false);
                  }}
                >
                  <Check className={cn("size-4", value?.id === job.id ? "opacity-100" : "opacity-0")} />
                  <span className="min-w-0">
                    <span className="block truncate">{jobLabel(job)}</span>
                    {job.address ? (
                      <span className="text-muted-foreground block truncate text-xs">{job.address}</span>
                    ) : null}
                  </span>
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

/** "Petersen · Panel upgrade", or the job's number when it has neither. */
export function jobLabel(job: ScheduleJob) {
  const who = job.customerName?.trim();
  const what = job.name?.trim();
  return [who, what].filter(Boolean).join(" · ") || `Job ${job.number}`;
}
