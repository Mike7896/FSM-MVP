import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

/**
 * The one label for something the product will do and doesn't yet.
 *
 * **One component, so one set of words.** It used to be "Soon" in the sidebar,
 * "Coming" on a trade pack and "Not ready yet" on a connection — three phrasings
 * of one fact, which reads as three different states. The variant follows the
 * surface it sits on; the words never change.
 */
export function ComingSoon({
  variant = "outline",
  className,
}: {
  variant?: "outline" | "secondary";
  className?: string;
}) {
  return (
    <Badge variant={variant} className={cn("shrink-0 whitespace-nowrap", className)}>
      Coming soon
    </Badge>
  );
}
