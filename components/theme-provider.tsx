"use client";

import { ThemeProvider as NextThemesProvider } from "next-themes";

/**
 * Theme provider.
 *
 * `attribute="class"` is required rather than optional: `app/globals.css`
 * declares `@custom-variant dark (&:is(.dark *))`, so every dark token is
 * scoped to descendants of a `.dark` element. Switching this to the `data-*`
 * strategy would silently disable the entire dark palette.
 *
 * `defaultTheme="system"` means a contractor who has their phone on dark gets
 * dark without being asked — which is most of them, on site, in a crawlspace.
 */
export function ThemeProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <NextThemesProvider
      attribute="class"
      defaultTheme="system"
      enableSystem
      disableTransitionOnChange
    >
      {children}
    </NextThemesProvider>
  );
}
