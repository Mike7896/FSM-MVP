"use client";

import Link from "next/link";
import { ChevronDown, Plus } from "lucide-react";

import { createDoors } from "@/lib/nav";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

/**
 * The global primary action — IA §3.1: "+ New Quote", in the header, always
 * visible.
 *
 * The button keeps its name rather than becoming a generic "+ New": quoting is
 * the common case and it should not pay for the rare ones. The other doors hang
 * off the caret.
 *
 * Each door names the *situation*, not the object ("You agreed it on the phone
 * and never quoted it"), which is how a contractor tells which one they are in.
 */
export function NewMenu() {
  return (
    <div className="flex items-center">
      <Button asChild className="rounded-r-none">
        <Link href="/quotes/new">
          <Plus />
          New quote
        </Link>
      </Button>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            size="icon"
            className="rounded-l-none border-l border-l-white/20"
            aria-label="Other things you can create"
          >
            <ChevronDown />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-80 p-1.5">
          {createDoors.map((door) => (
            <DropdownMenuItem key={door.href} asChild className="items-start px-3 py-3">
              <Link href={door.href}>
                <span className="grid min-w-0 gap-1">
                  <span className="text-sm font-medium leading-5">{door.title}</span>
                  <span className="text-muted-foreground text-xs leading-relaxed">
                    {door.description}
                  </span>
                </span>
              </Link>
            </DropdownMenuItem>
          ))}
          <div className="text-muted-foreground mt-1 border-t px-3 py-3 text-xs leading-relaxed">
            Whichever you pick, the job gets made behind it. You never create one
            first.
          </div>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
