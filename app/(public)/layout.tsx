import Link from "next/link";

import { Wordmark } from "@/components/brand";
import { SocialLinks } from "@/components/social-links";
import { ModeToggle } from "@/components/mode-toggle";
import { Button } from "@/components/ui/button";

/**
 * The pre-auth shell — class B·W.
 *
 * W is a **scope boundary, not a design**: the public pages, signup and the
 * first quote must work with no install, so activation never waits on one.
 * Everything on-site after the first send assumes the app.
 *
 * Every public CTA lands in the same activation flow. A page varies which trade
 * is pre-selected and which headline preceded the click — never where it goes.
 */
export default function PublicLayout({ children }: LayoutProps<"/">) {
  return (
    <div className="flex min-h-full flex-1 flex-col">
      <header className="sticky top-0 z-20 border-b border-border/60 bg-background/90 backdrop-blur-xl">
        <div className="mx-auto flex h-18 w-full max-w-[1248px] items-center justify-between gap-2 px-3 sm:gap-4 sm:px-6">
          <Link href="/" className="flex items-center">
            <Wordmark size={20} />
          </Link>

          <nav className="hidden items-center gap-6 text-sm md:flex">
            <Link href="/#product-tour" className="text-muted-foreground hover:text-foreground transition-colors">
              How it works
            </Link>
            <Link
              href="/pricing"
              className="text-muted-foreground hover:text-foreground transition-colors"
            >
              Pricing
            </Link>
          </nav>

          <div className="flex items-center gap-2">
            <ModeToggle />
            <Button asChild variant="ghost" size="sm" className="max-[380px]:px-2 max-[380px]:text-xs">
              <Link href="/login">Sign in</Link>
            </Button>
            <Button asChild size="sm" className="max-[380px]:px-2 max-[380px]:text-xs">
              <Link href="/signup">Start free</Link>
            </Button>
          </div>
        </div>
        <nav aria-label="Explore ServiceClerk" className="flex items-center justify-center gap-6 border-t border-border/60 px-3 text-xs md:hidden">
          <Link href="/#product-tour" className="py-3">How it works</Link>
          <Link href="/pricing" className="py-3">Pricing</Link>
        </nav>
      </header>

      <main className="flex-1">{children}</main>

      <footer className="border-t">
        <div className="mx-auto flex w-full max-w-[1248px] flex-col gap-6 px-5 py-10 sm:px-6">
          <div className="flex flex-col gap-6 sm:flex-row sm:justify-between">
            <div className="max-w-xs">
              <Wordmark />
              {/* The descriptor travels with the name wherever the name is
                  not yet known — Brand Kit, "Name and Descriptor". */}
              <p className="text-muted-foreground mt-3 text-sm">
                Job management for the trades.
              </p>
            </div>

            <div className="flex flex-wrap gap-x-8 gap-y-6 text-sm sm:gap-x-12">
              <div className="flex flex-col gap-2">
                <span className="text-muted-foreground font-label text-[10px] uppercase">
                  Product
                </span>
                <Link href="/#product-tour" className="hover:underline">How it works</Link>
                <Link href="/pricing" className="hover:underline">
                  Pricing
                </Link>
                <Link href="/support" className="hover:underline">
                  Support
                </Link>
              </div>
              <div className="flex flex-col gap-2">
                <span className="text-muted-foreground font-label text-[10px] uppercase">
                  Follow the build
                </span>
                <SocialLinks
                  className="text-muted-foreground flex-col items-start gap-2"
                />
              </div>
              <div className="flex flex-col gap-2">
                <span className="text-muted-foreground font-label text-[10px] uppercase">
                  Legal
                </span>
                <Link href="/legal/terms" className="hover:underline">
                  Terms
                </Link>
                <Link href="/legal/privacy" className="hover:underline">
                  Privacy
                </Link>
              </div>
            </div>
          </div>

          <p className="text-muted-foreground border-t pt-6 text-xs">
            © {new Date().getFullYear()} ServiceClerk
          </p>
        </div>
      </footer>
    </div>
  );
}
