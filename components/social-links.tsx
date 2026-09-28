import { SOCIAL_ACCOUNTS } from "@/lib/social";
import { cn } from "@/lib/utils";

/**
 * The accounts, as links.
 *
 * **Named rather than badged.** Lucide dropped its brand marks, and a
 * hand-drawn approximation of somebody else's logo looks wrong in exactly the
 * way a trust surface cannot afford — so these are the platform names, set
 * quietly. Real marks are a package away (`simple-icons`) whenever the brand
 * pass wants them.
 *
 * `rel="me"` is the small, correct thing: it tells anything reading the page
 * that these profiles are the same entity as the site, which is what Mastodon
 * verification and a few search crawlers look for.
 */
export function SocialLinks({
  className,
  itemClassName,
}: {
  className?: string;
  itemClassName?: string;
}) {
  return (
    <ul className={cn("flex flex-wrap items-center gap-x-4 gap-y-2", className)}>
      {SOCIAL_ACCOUNTS.map((account) => (
        <li key={account.name}>
          <a
            href={account.href}
            target="_blank"
            rel="me noreferrer"
            aria-label={account.label}
            className={cn(
              "hover:text-foreground underline-offset-4 transition-colors hover:underline",
              itemClassName
            )}
          >
            {account.name}
          </a>
        </li>
      ))}
    </ul>
  );
}
