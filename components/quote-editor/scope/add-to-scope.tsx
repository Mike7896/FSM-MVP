"use client";

import {
  ResponsiveDialog,
  ResponsiveDialogBody,
  ResponsiveDialogContent,
  ResponsiveDialogHeader,
} from "@/components/responsive-dialog";
import { NODE_DOORS, type NodeType } from "@/lib/quote";
import { cn } from "@/lib/utils";

/**
 * Add to scope — **six doors for seven types.**
 *
 * The picker is where the composability claim is most easily broken, so the
 * rules it holds are worth stating:
 *
 * - **Every door produces a row.** No door opens a different kind of editor.
 *   One shape, seven types, which is what keeps a composable structure from
 *   reading as seven features.
 * - **The trade's words, never the model's.** "Something not included" for
 *   exclusion, "a price to be settled later" for allowance, "a heading with a
 *   subtotal" for group. An electrician does not add an allowance node — he
 *   puts a number in he'll fix later.
 * - **Ordered by frequency, not by the model.** A priced line first and
 *   framed, because it is the overwhelming majority of every quote. Group sits
 *   fifth even though the model treats it as structurally central: organising
 *   is something he does after the rows exist.
 * - **Note and assumption share a door.** The difference between them is
 *   whether the sentence is a condition, and that is decided by what he writes
 *   rather than by which button he pressed. The row's own menu retypes it after
 *   the fact.
 * - **Optional is not a door.** It is a flag on a row he has already added,
 *   since it is a boolean and not a type — a seventh door for it would put a
 *   row's price and its availability in the same choice.
 * - **It says where the row will land.** A tree editor that does not name the
 *   node you are adding to produces rows in the wrong place, and the recovery
 *   is a drag on a phone.
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
  return (
    <ResponsiveDialog open={open} onOpenChange={onOpenChange}>
      <ResponsiveDialogContent desktopClassName="sm:max-w-lg">
        <ResponsiveDialogHeader
          title="Add to scope"
          description={
            parentName ? `Inside ${parentName}` : "At the top of the quote"
          }
        />

        <ResponsiveDialogBody className="flex flex-col gap-2 pb-4">
          {NODE_DOORS.map((spec, index) => (
            <button
              key={spec.type}
              type="button"
              onClick={() => {
                onPick(spec.type);
                onOpenChange(false);
              }}
              className={cn(
                "rounded-lg border p-3 text-left transition-colors",
                // The first door is framed because it is what he is almost
                // always here to do. Ranking without saying so would leave the
                // ordering to be discovered.
                index === 0
                  ? "border-primary/60 bg-primary/[0.03] hover:bg-primary/[0.06]"
                  : "hover:bg-muted/50"
              )}
            >
              <span className="block text-sm font-medium">{spec.door.title}</span>
              <span className="text-muted-foreground mt-1 block text-xs leading-relaxed">
                {spec.door.blurb}
              </span>
            </button>
          ))}

          <p className="text-muted-foreground px-1 pt-1 text-xs leading-relaxed">
            Any row can be marked optional after you add it — she chooses
            whether it&apos;s in.
          </p>
        </ResponsiveDialogBody>
      </ResponsiveDialogContent>
    </ResponsiveDialog>
  );
}
