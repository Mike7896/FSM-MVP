import type { Metadata } from "next";
import { Archivo, Inter } from "next/font/google";

import { QueryProvider } from "@/components/query-provider";
import { ThemeProvider } from "@/components/theme-provider";
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import "./globals.css";

// The two interface faces from the brand kit: Inter for body, Archivo for
// headings, labels and the marks. These variable names are what
// app/globals.css maps into Tailwind's theme (`--font-sans` /
// `--font-heading`), and what components/brand.tsx sets the marks in.
// Renaming them here silently drops the font.
const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
});

const archivo = Archivo({
  variable: "--font-archivo",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: {
    default: "ServiceClerk",
    template: "%s | ServiceClerk",
  },
  description: "Job management for the trades.",
  applicationName: "ServiceClerk",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    // suppressHydrationWarning is required: next-themes sets the class on
    // <html> before React hydrates, so the server and client markup differ by
    // design on exactly this element.
    <html
      lang="en"
      suppressHydrationWarning
      className={`${inter.variable} ${archivo.variable} h-full antialiased`}
    >
      {/* Browser extensions (Grammarly among them) stamp their own attributes
          on <body> before React hydrates. This ignores attribute differences
          on this one element only — its children are still checked. */}
      <body
        suppressHydrationWarning
        className="bg-background text-foreground flex min-h-full flex-col"
      >
        {/*
          Required globally, not optional. `SidebarMenuButton` renders a
          Tooltip whenever it is given a `tooltip` prop — which is how the
          collapsed icon-rail sidebar labels itself — and Radix throws if there
          is no Provider above it. This version of shadcn's `SidebarProvider`
          imports `TooltipContent` but does not supply the Provider, so it has
          to live here.
        */}
        <ThemeProvider>
          <QueryProvider>
            <TooltipProvider>
              {children}
              <Toaster />
            </TooltipProvider>
          </QueryProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
