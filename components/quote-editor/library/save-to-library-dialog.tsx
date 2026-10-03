"use client";

import { useState, type FormEvent } from "react";
import { toast } from "sonner";

import { useLibraryMutations } from "@/components/quote-editor/library/use-library";
import {
  ResponsiveDialog,
  ResponsiveDialogBody,
  ResponsiveDialogContent,
  ResponsiveDialogFooter,
  ResponsiveDialogHeader,
} from "@/components/responsive-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { templateFromNode } from "@/lib/library";
import { NODE_SPEC, allNodes, isPriced, type ScopeNode } from "@/lib/quote";

/**
 * "Save to library" from a row's menu. Keeps a copy of the row and everything
 * inside it; the row on this quote is left exactly as it is.
 */
export function SaveToLibraryDialog({
  node,
  onOpenChange,
  onSaved,
}: {
  node: ScopeNode;
  onOpenChange: (open: boolean) => void;
  /** After it's saved — the editor offers to show it in the Library. */
  onSaved: () => void;
}) {
  const kind = NODE_SPEC[node.type].label.toLowerCase();
  const [name, setName] = useState(node.description.trim());
  const { create } = useLibraryMutations(null);

  const inside = allNodes(node.children).length;
  const priced = allNodes([node]).filter(isPriced).length;

  function submit(event: FormEvent) {
    event.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) return;
    create.mutate(
      { name: trimmed, template: templateFromNode(node) },
      {
        onSuccess: () => {
          onOpenChange(false);
          onSaved();
        },
        onError: (error) => toast.error(error.message),
      }
    );
  }

  return (
    <ResponsiveDialog open onOpenChange={onOpenChange}>
      <ResponsiveDialogContent desktopClassName="sm:max-w-md">
        <form onSubmit={submit} className="flex flex-col">
          <ResponsiveDialogHeader
            title="Save to library"
            description={
              inside
                ? `Keeps a copy of this ${kind} and the ${inside} row${inside === 1 ? "" : "s"} inside it.`
                : `Keeps a copy of this ${kind}${priced ? ", with its quantity and price" : ""}.`
            }
          />
          <ResponsiveDialogBody className="flex flex-col gap-3">
            <div className="grid gap-1.5">
              <Label htmlFor="saved-item-name">Name</Label>
              <Input
                id="saved-item-name"
                value={name}
                onChange={(event) => setName(event.target.value)}
                placeholder="What you'll look for in the library"
                autoFocus
                maxLength={120}
              />
            </div>
            <p className="text-muted-foreground text-xs leading-relaxed">
              It shows up in the Library tab on every quote. Changing it there
              later won&apos;t change this quote.
            </p>
          </ResponsiveDialogBody>
          <ResponsiveDialogFooter className="flex justify-end gap-2">
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={!name.trim() || create.isPending}>
              {create.isPending ? "Saving" : "Save"}
            </Button>
          </ResponsiveDialogFooter>
        </form>
      </ResponsiveDialogContent>
    </ResponsiveDialog>
  );
}
