"use client";

import { useRef, type KeyboardEvent } from "react";
import {
  Ban,
  FolderOpen,
  Layers,
  ReceiptText,
  StickyNote,
  WalletCards,
  type LucideIcon,
} from "lucide-react";

import {
  ResponsiveDialog,
  ResponsiveDialogBody,
  ResponsiveDialogContent,
  ResponsiveDialogHeader,
} from "@/components/responsive-dialog";
import { Kbd } from "@/components/ui/kbd";
import { NODE_DOORS, type NodeType } from "@/lib/quote";
import { cn } from "@/lib/utils";

/** One icon per kind, so the list can be scanned without reading it. */
const ICONS: Partial<Record<NodeType, LucideIcon>> = {
  item: ReceiptText,
  assembly: Layers,
  exclusion: Ban,
  allowance: WalletCards,
  group: FolderOpen,
  note: StickyNote,
};

/**
 * Add to scope — one choice per kind of row, most common first.
 *
 * Every choice adds a row in place. The number beside each one picks it from
 * the keyboard. Optional is not a choice here: it's a switch on a row that
 * already exists.
 */
export function AddToScope({
  open,
  onOpenChange,
  parentName,
  onPick,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The container the row will land in. Null means the top of the quote. */
  parentName: string | null;
  onPick: (type: NodeType) => void;
}) {
  // Set when a kind was chosen, so closing leaves the cursor in the new row
  // instead of handing it back to the button that opened the picker.
  const picked = useRef(false);

  function pick(type: NodeType) {
    picked.current = true;
    onPick(type);
    onOpenChange(false);
  }

  function onKeyDown(event: KeyboardEvent) {
    if (event.metaKey || event.ctrlKey || event.altKey) return;
    const door = NODE_DOORS[Number(event.key) - 1];
    if (!door) return;
    event.preventDefault();
    pick(door.type);
  }

  return (
    <ResponsiveDialog open={open} onOpenChange={onOpenChange}>
      <ResponsiveDialogContent
        desktopClassName="sm:max-w-xl"
        onKeyDown={onKeyDown}
        onOpenAutoFocus={() => {
          picked.current = false;
        }}
        onCloseAutoFocus={(event) => {
          if (picked.current) event.preventDefault();
        }}
      >
        <ResponsiveDialogHeader
          title="Add to scope"
          description={
            parentName ? `Inside ${parentName}` : "At the end of the quote"
          }
        />

        <ResponsiveDialogBody className="flex flex-col gap-2 pb-4">
          {NODE_DOORS.map((spec, index) => {
            const Icon = ICONS[spec.type] ?? ReceiptText;
            return (
              <button
                key={spec.type}
                type="button"
                onClick={() => pick(spec.type)}
                className={cn(
                  "flex items-start gap-3 rounded-lg border p-3 text-left transition-colors",
                  index === 0
                    ? "border-primary/60 bg-primary/[0.04] hover:bg-primary/[0.08]"
                    : "hover:bg-muted/60"
                )}
              >
                <span
                  aria-hidden
                  className={cn(
                    "flex size-8 shrink-0 items-center justify-center rounded-md",
                    index === 0
                      ? "bg-primary/20 text-primary-ink"
                      : "bg-muted text-muted-foreground"
                  )}
                >
                  <Icon className="size-4" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-semibold">
                    {spec.door.title}
                  </span>
                  <span className="text-muted-foreground mt-0.5 block text-[13px] leading-relaxed">
                    {spec.door.blurb}
                  </span>
                </span>
                <Kbd className="mt-0.5 hidden sm:inline-flex">{index + 1}</Kbd>
              </button>
            );
          })}

          <p className="text-muted-foreground px-1 pt-1 text-xs leading-relaxed">
            Any priced row or group can be made optional after you add it — your
            customer chooses whether it&apos;s in.
          </p>
        </ResponsiveDialogBody>
      </ResponsiveDialogContent>
    </ResponsiveDialog>
  );
}
