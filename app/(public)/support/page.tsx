import type { Metadata } from "next";
import Link from "next/link";
import { Mail } from "lucide-react";

import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { Button } from "@/components/ui/button";
import { serverEnv } from "@/lib/env";
import { HELP_FAQS } from "@/lib/help/articles";

export const metadata: Metadata = { title: "Support" };

/**
 * Support, before sign-in — for someone who can't get in, or hasn't yet.
 *
 * **There is always a way to a person.** Signed in, Help sends a request with
 * the account attached. Signed out — locked out, most likely — this page gives
 * the support address outright. Nobody should have to be a customer in good
 * standing to ask why they can't sign in.
 */
export default function SupportPage() {
  const email = serverEnv().SUPPORT_EMAIL;

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-12 px-4 py-16 sm:px-6">
      <div className="max-w-2xl">
        <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">Support</h1>
        <p className="text-muted-foreground mt-4 text-lg">
          Answers to common questions, and a person when you need one.
        </p>
      </div>

      <section className="grid gap-4 sm:grid-cols-2">
        <div className="flex flex-col gap-3 rounded-xl border p-5">
          <p className="font-medium">Using ServiceClerk already?</p>
          <p className="text-muted-foreground text-sm leading-relaxed">
            Sign in and open Help. You can report a problem, suggest a feature, or ask for help,
            and your account comes with it — so we can look straight at what you&apos;re seeing.
          </p>
          <Button asChild className="mt-auto self-start">
            <Link href="/login?next=/help">Sign in to get help</Link>
          </Button>
        </div>
        <div className="flex flex-col gap-3 rounded-xl border p-5">
          <p className="font-medium">Can&apos;t sign in?</p>
          <p className="text-muted-foreground text-sm leading-relaxed">
            Try{" "}
            <Link href="/forgot-password" className="text-foreground underline underline-offset-4">
              resetting your password
            </Link>{" "}
            first.
            {email ? " Still stuck, or not a customer yet? Email us and a person will answer." : null}
          </p>
          {email ? (
            <Button asChild variant="outline" className="mt-auto self-start">
              <a href={`mailto:${email}`}>
                <Mail className="size-4" />
                {email}
              </a>
            </Button>
          ) : null}
        </div>
      </section>

      <section>
        <h2 className="text-muted-foreground mb-3 font-label text-[11px] uppercase">Common questions</h2>
        <Accordion type="multiple" className="rounded-xl border px-4">
          {HELP_FAQS.map((faq) => (
            <AccordionItem key={faq.question} value={faq.question}>
              <AccordionTrigger className="text-left text-sm font-medium">{faq.question}</AccordionTrigger>
              <AccordionContent className="text-muted-foreground text-sm leading-relaxed">
                {faq.answer}
              </AccordionContent>
            </AccordionItem>
          ))}
        </Accordion>
      </section>
    </div>
  );
}
