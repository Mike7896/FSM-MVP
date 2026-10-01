import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowRight, ChevronLeft } from "lucide-react";

import { ArticleBody } from "@/components/help/article-body";
import { Button } from "@/components/ui/button";
import { helpArticle } from "@/lib/help/articles";

import { contactHref } from "../help-links";

export async function generateMetadata({ params }: PageProps<"/help/[slug]">): Promise<Metadata> {
  const article = helpArticle((await params).slug);
  return { title: article ? `${article.title} · Help` : "Help" };
}

/**
 * One help article — steps first, a button to the screen it's about, and a
 * person at the bottom for when it didn't answer the question.
 */
export default async function HelpArticlePage({ params }: PageProps<"/help/[slug]">) {
  const article = helpArticle((await params).slug);
  if (!article) notFound();

  const related = (article.related ?? [])
    .map((slug) => helpArticle(slug))
    .filter((entry) => entry !== null);

  return (
    <article className="mx-auto flex w-full max-w-2xl flex-col gap-8">
      <div>
        <Link
          href="/help"
          className="text-muted-foreground hover:text-foreground inline-flex items-center gap-1 text-sm"
        >
          <ChevronLeft className="size-4" />
          Help
        </Link>
        <p className="text-muted-foreground mt-4 font-label text-[11px] uppercase">{article.category}</p>
        <h1 className="mt-1 text-2xl font-semibold tracking-tight">{article.title}</h1>
        <p className="text-muted-foreground mt-2">{article.summary}</p>
        {article.where ? (
          <Button asChild variant="outline" size="sm" className="mt-4">
            <Link href={article.where.href}>
              {article.where.label}
              <ArrowRight className="size-4" />
            </Link>
          </Button>
        ) : null}
      </div>

      <ArticleBody blocks={article.body} />

      {related.length ? (
        <section className="border-t pt-6">
          <h2 className="text-muted-foreground mb-2 font-label text-[11px] uppercase">Related</h2>
          <ul className="flex flex-col gap-1">
            {related.map((entry) => (
              <li key={entry.slug}>
                <Link href={`/help/${entry.slug}`} className="text-sm underline-offset-4 hover:underline">
                  {entry.title}
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <section className="bg-muted/40 flex flex-col gap-3 rounded-xl border p-5 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="text-sm font-medium">Didn&apos;t answer it?</p>
          <p className="text-muted-foreground text-sm">Ask a person — we answer by email.</p>
        </div>
        <Button asChild>
          <Link href={contactHref("help", `/help/${article.slug}`)}>Get help from a person</Link>
        </Button>
      </section>
    </article>
  );
}
