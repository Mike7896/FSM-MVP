"use client";

import {
  ResponsiveDialog,
  ResponsiveDialogBody,
  ResponsiveDialogContent,
  ResponsiveDialogFooter,
  ResponsiveDialogHeader,
} from "@/components/responsive-dialog";
import {
  ScopeActionsProvider,
  useScopeActions,
} from "@/components/quote-editor/scope/actions";
import {
  NODE_BODIES,
  bodyKind,
} from "@/components/quote-editor/scope/node-bodies";
import { ScopeTree } from "@/components/quote-editor/scope/scope-tree";
import { Button } from "@/components/ui/button";
import {
  NODE_SPEC,
  baseTotal,
  formatMoney,
  isContainer,
  type ScopeNode,
} from "@/lib/quote";

/**
 * One node, opened on a phone.
 *
 * **It mounts the same body the desk draws in place.** The sheet does not
 * reimplement the fields — it re-provides the actions with `mode: "edit"` and
 * renders the body the registry already chose. Two editors for the same row is
 * how a phone and a desk come to disagree about what an allowance is, and it is
 * the exact failure the one-row-shape rule exists to prevent.
 *
 * A container opens with its children under it, still as tree rows, so the
 * assembly's divergence — one row to her, five to him — is visible at 375px
 * rather than being a desk-only fact.
 */
export function NodeSheet({
  node,
  open,
  onOpenChange,
}: {
  node: ScopeNode;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const actions = useScopeActions();
  const spec = NODE_SPEC[node.type];
  const Body = NODE_BODIES[bodyKind(node.type)];

  return (
    <ResponsiveDialog open={open} onOpenChange={onOpenChange}>
      <ResponsiveDialogContent desktopClassName="sm:max-w-xl">
        <ResponsiveDialogHeader
          title={
            <span className="font-label text-[11px] uppercase">
              {spec.label}
            </span>
          }
          description={spec.door?.blurb}
        />

        <ResponsiveDialogBody className="px-0">
          <ScopeActionsProvider value={{ ...actions, mode: "edit" }}>
            <Body node={node} />
            {isContainer(node) ? (
              <div className="mt-1">
                <ScopeTree nodes={node.children} depth={1} />
              </div>
            ) : null}
          </ScopeActionsProvider>
        </ResponsiveDialogBody>

        <ResponsiveDialogFooter className="flex items-center justify-between gap-3">
          {spec.priced || spec.container ? (
            <span className="flex items-baseline gap-2">
              <span className="text-muted-foreground font-label text-[11px] uppercase">
                {node.optional ? "If she adds it" : "In the price"}
              </span>
              <span className="font-semibold tabular-nums">
                {formatMoney(
                  node.optional
                    ? // An optional row's own money, since `baseTotal` correctly
                      // reports zero for it — the sheet is the one place that
                      // number has to be visible to be edited.
                      baseTotal({ ...node, optional: false })
                    : baseTotal(node)
                )}
              </span>
            </span>
          ) : (
            <span />
          )}
          <Button onClick={() => onOpenChange(false)}>Done</Button>
        </ResponsiveDialogFooter>
      </ResponsiveDialogContent>
    </ResponsiveDialog>
  );
}
