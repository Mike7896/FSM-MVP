"use client";

import { useState } from "react";
import Link from "next/link";
import { ChevronRight, Search } from "lucide-react";

import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { Input } from "@/components/ui/input";
import {
  HELP_ARTICLES,
  HELP_CATEGORIES,
  HELP_FAQS,
  helpArticle,
  searchableText,
} from "@/lib/help/articles";

/**
 * The articles and the questions, with one box that narrows both.
 *
 * Search is a plain match on every word typed, across titles and bodies —
 * there are a few dozen pages, and the answer has to show up while they're
 * still typing, not after a round trip.
 */
export function HelpBrowser({ contactHref }: { contactHref: string }) {
  const [query, setQuery] = useState("");
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  const matches = (text: string) => words.every((word) => text.includes(word));

  const articles = HELP_ARTICLES.filter((article) => matches(searchableText(article)));
  const faqs = HELP_FAQS.filter((faq) => matches(`${faq.question} ${faq.answer}`.toLowerCase()));
  const searching = words.length > 0;

  return (
    <div className="flex flex-col gap-10">
      <div className="relative">
        <Search className="text-muted-foreground pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2" />
        <Input
          type="search"
          aria-label="Search help"
          placeholder="Search help"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          className="h-11 pl-9 text-base"
        />
      </div>

      {searching && articles.length === 0 && faqs.length === 0 ? (
        <p className="text-muted-foreground text-sm">
          Nothing here matches that.{" "}
          <Link href={contactHref} className="text-foreground underline underline-offset-4">
            Ask a person instead
          </Link>
          .
        </p>
      ) : null}

      {/* Articles, by what they're about. */}
      {HELP_CATEGORIES.map((category) => {
        const inCategory = articles.filter((article) => article.category === category);
        if (inCategory.length === 0) return null;
        return (
          <section key={category} aria-label={category}>
            <h2 className="text-muted-foreground mb-2 font-label text-[11px] uppercase">{category}</h2>
            <ul className="divide-y rounded-xl border">
              {inCategory.map((article) => (
                <li key={article.slug}>
                  <Link
                    href={`/help/${article.slug}`}
                    className="hover:bg-muted/40 flex items-center gap-3 px-4 py-3 transition-colors"
                  >
                    <span className="min-w-0 flex-1">
                      <span className="block text-sm font-medium">{article.title}</span>
                      <span className="text-muted-foreground block text-sm">{article.summary}</span>
                    </span>
                    <ChevronRight className="text-muted-foreground size-4 shrink-0" />
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        );
      })}

      {faqs.length ? (
        <section aria-label="Common questions">
          <h2 className="text-muted-foreground mb-2 font-label text-[11px] uppercase">Common questions</h2>
          <Accordion type="multiple" className="rounded-xl border px-4">
            {faqs.map((faq) => {
              const article = faq.article ? helpArticle(faq.article) : null;
              return (
                <AccordionItem key={faq.question} value={faq.question}>
                  <AccordionTrigger className="text-left text-sm font-medium">{faq.question}</AccordionTrigger>
                  <AccordionContent className="text-muted-foreground text-sm leading-relaxed">
                    <p>{faq.answer}</p>
                    {article ? (
                      <Link
                        href={`/help/${article.slug}`}
                        className="text-foreground mt-2 inline-block underline underline-offset-4"
                      >
                        {article.title}
                      </Link>
                    ) : null}
                  </AccordionContent>
                </AccordionItem>
              );
            })}
          </Accordion>
        </section>
      ) : null}
    </div>
  );
}
