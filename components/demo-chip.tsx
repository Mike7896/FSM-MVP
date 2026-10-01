import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

/**
 * The label a demo wears wherever it is drawn.
 *
 * **The flag rides the object, never a mode the app is in** — he can hold a
 * demo quote and a real one at the same time — so every list, header and
 * document that shows a demo quote, job or customer draws this beside it, and
 * nothing has to remember to hide one.
 */
export function DemoChip({ className }: { className?: string }) {
  return (
    <Badge
      variant="outline"
      className={cn(
        "shrink-0 font-label text-[10px] uppercase",
        className
      )}
    >
      Demo
    </Badge>
  );
}
