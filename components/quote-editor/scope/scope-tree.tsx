"use client";

import styles from "./scope.module.css";

import { useScopeActions } from "@/components/quote-editor/scope/actions";
import {
  NODE_BODIES,
  bodyKind,
} from "@/components/quote-editor/scope/node-bodies";
import {
  SECTION_PAD,
} from "@/components/quote-editor/section-heading";
import { Button } from "@/components/ui/button";
import { isContainer, isText, type ScopeNode } from "@/lib/quote";
import { cn } from "@/lib/utils";

/**
 * The Scope tree.
 *
 * **This file is the composition claim.** Scope is an ordered tree of typed
 * nodes, and the design constraint that follows is negative: seven types are
 * values of one attribute, so they must not become seven editors, seven row
 * shapes, or seven branches of a menu that read as different features.
 *
 * What is here, and what is deliberately not:
 *
 * - **One recursion.** `ScopeTree` renders nodes; `ScopeNode` renders one and
 *   asks `ScopeTree` for its children. Nesting is two mutually recursive
 *   components and no special case per container type — a group and an assembly
 *   differ in what they mean, not in how they hold rows.
 * - **One row shape.** `NodeRow` owns the geometry: the indent, the badge, the
 *   optional marker, the amount column. Every type gets the same row.
 * - **Three bodies, not seven.** The only thing that genuinely differs between
 *   types is what sits in the description cell. `node-bodies.tsx` holds those
 *   three and the registry says which one a type uses.
 *
 * **Spacing carries the hierarchy, and it is deliberately not uniform.** A tree
 * drawn with one rhythm is a list: every row the same height and the same
 * distance from its neighbours means a group, its children and an unrelated
 * exclusion all look equally related — which is exactly as much as they look
 * unrelated. So distance means something here:
 *
 * - **top-level nodes are blocks**, framed and separated by real space, because
 *   they are the parts of the job a contractor thinks of separately;
 * - **children sit tight under their parent**, railed and divided by hairlines,
 *   because they belong to it and to each other;
 * - **the indent is compact and the rail is visible**, so depth reads at a glance
 *   rather than on inspection.
 *
 * That is proximity doing the work instead of the reader.
 */
export function ScopeTree({
  nodes,
  depth = 0,
}: {
  nodes: ScopeNode[];
  depth?: number;
}) {
  if (nodes.length === 0) return null;

  if (depth === 0) {
    // Blocks. The gap between them is the point — two root nodes are the least
    // related things in the section and should look it.
    return (
      // Separate root blocks while preserving the exact document order.
      <ul className={styles.roots}>
        {runsOf(nodes).map((run) =>
          run.length > 1 ? (
            // A run of adjacent unpriced rows shares one frame. **This is not
            // gathering** — nothing is reordered and nothing moves; they are
            // already neighbours in the tree, and one frame is what neighbours
            // look like. Move an exclusion up between two groups and it becomes
            // its own block again, which is the honest result.
            <li key={run[0].key} className={styles.rootBlock}>
              <div className={styles.textRun}>
                {run.map((node) => (
                  <ScopeNode
                    key={node.key}
                    node={node}
                    depth={depth}
                    framed={false}
                  />
                ))}
              </div>
            </li>
          ) : (
            <li key={run[0].key} className={styles.rootBlock}>
              <ScopeNode node={run[0]} depth={depth} />
            </li>
          )
        )}
      </ul>
    );
  }

  // Inside a container: tight, railed, and divided so siblings are countable.
  return (
    <ul className={styles.children} data-deep={depth > 3 || undefined}>
      {nodes.map((node) => (
        <li key={node.key} data-container={isContainer(node) || undefined}>
          <ScopeNode node={node} depth={depth} />
        </li>
      ))}
    </ul>
  );
}

/**
 * Splits the root list into runs of adjacent unpriced text, and singletons of
 * everything else. Order is preserved exactly — this only decides where a frame
 * starts and stops.
 */
function runsOf(nodes: ScopeNode[]): ScopeNode[][] {
  const runs: ScopeNode[][] = [];

  for (const node of nodes) {
    const last = runs.at(-1);
    if (isText(node) && last && isText(last[0])) last.push(node);
    else runs.push([node]);
  }

  return runs;
}

function ScopeNode({
  node,
  depth,
  /** False when the caller has already drawn a frame around a run of rows. */
  framed = true,
}: {
  node: ScopeNode;
  depth: number;
  framed?: boolean;
}) {
  const { mode, add } = useScopeActions();
  const Body = NODE_BODIES[bodyKind(node.type)];

  if (!isContainer(node)) {
    return (
      <div
        className={cn(
          // A root-level leaf is its own block and gets the same frame a group
          // gets, so a permit line and a group read as the same kind of thing:
          // a part of the job. Without it, the bare rows between two framed
          // groups look like they fell out of one.
          //
          // A run of text rows is framed by the caller instead, so a lone one
          // frames itself and a neighbouring pair shares one.
          depth === 0 && framed && isText(node) && "bg-muted/15"
        )}
      >
        <Body node={node} />
      </div>
    );
  }

  return (
    <div>
      {/* The heading, and the rule under it that says the rows below belong. */}
      <div className={styles.containerHeader}>
        <Body node={node} />
      </div>

      <ScopeTree nodes={node.children} depth={depth + 1} />

      {/* **After the children, not before them.** The picker says where a row
          will land, and an "add inside" that sits above the rows it will be
          added below says the opposite of what it does. */}
      {mode === "edit" ? (
        // On the rail and at the children's inset, so it reads as the next
        // row of the group rather than a loose link under it. `-ml-2` takes
        // back the button's own padding, so its "+" lines up with their text.
        <div className={styles.addInside}>
          <div className={cn(SECTION_PAD, "pt-1 pb-2")}>
            <Button
              variant="ghost"
              size="sm"
              className="text-muted-foreground -ml-2 h-auto min-h-8 whitespace-normal px-2 text-left text-xs"
              onClick={() => add(node.key)}
            >
              + Add inside {node.description || "this"}
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
