import Link from "next/link";

import { Wordmark } from "@/components/brand";

export default function AuthLayout({ children }: LayoutProps<"/">) {
  return (
    <>
      {/* Signup is where the name is still new, so the mark sits over it —
          wireframe 30a. It leads back to the site, not into the app. */}
      <header className="flex h-14 shrink-0 items-center px-4 sm:px-6">
        <Link href="/" className="flex items-center">
          <Wordmark />
        </Link>
      </header>
      <main className="flex flex-1 items-center justify-center p-6">
        {children}
      </main>
    </>
  );
}
