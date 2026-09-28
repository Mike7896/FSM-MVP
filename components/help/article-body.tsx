import { Lightbulb } from "lucide-react";

import type { HelpBlock } from "@/lib/help/articles";

/** An article's blocks, set as a readable page — short measure, real steps. */
export function ArticleBody({ blocks }: { blocks: HelpBlock[] }) {
  return (
    <div className="flex flex-col gap-4 text-[15px] leading-relaxed">
      {blocks.map((block, index) => {
        switch (block.type) {
          case "p":
            return <p key={index}>{block.text}</p>;
          case "h":
            return (
              <h2 key={index} className="mt-4 text-base font-semibold tracking-tight">
                {block.text}
              </h2>
            );
          case "steps":
            return (
              <ol key={index} className="flex flex-col gap-3">
                {block.items.map((item, step) => (
                  <li key={step} className="flex gap-3">
                    <span className="bg-muted text-muted-foreground flex size-6 shrink-0 items-center justify-center rounded-full text-xs font-medium tabular-nums">
                      {step + 1}
                    </span>
                    <span className="pt-0.5">{item}</span>
                  </li>
                ))}
              </ol>
            );
          case "list":
            return (
              <ul key={index} className="flex flex-col gap-2 pl-1">
                {block.items.map((item, entry) => (
                  <li key={entry} className="flex gap-3">
                    <span className="bg-muted-foreground mt-2.5 size-1.5 shrink-0 rounded-full" />
                    <span>{item}</span>
                  </li>
                ))}
              </ul>
            );
          case "tip":
            return (
              <p key={index} className="bg-muted/50 flex gap-3 rounded-lg border px-4 py-3 text-sm">
                <Lightbulb className="text-primary-ink mt-0.5 size-4 shrink-0" />
                <span>{block.text}</span>
              </p>
            );
        }
      })}
    </div>
  );
}
