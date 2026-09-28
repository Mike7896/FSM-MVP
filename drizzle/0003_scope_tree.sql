-- Scope becomes an ordered tree of typed nodes.
--
-- The DDL below is drizzle-kit's, **reordered by hand around a data
-- migration**. Three things happen here, and the order matters:
--
--   1. `line_items` gains `type`, `parent_id` and `optional`, and `section`
--      becomes nullable — a container takes its money from its children and a
--      note has no cost bucket at all.
--   2. The prose on `quotes.exclusions` and `quotes.assumptions` is converted
--      into Scope nodes, one per non-empty line, appended to the end of each
--      quote's tree in the order they were written.
--   3. Only then are the two columns dropped and the check constraint added.
--
-- Generated output drops the columns first and adds the constraint last.
-- Dropping before the text is moved would lose every exclusion in the
-- database, which is the one piece of a quote whose absence turns excluded
-- work into free work — so the two statements are moved to the end and the
-- constraint is added after the rows it has to be true of.

CREATE TYPE "public"."line_item_type" AS ENUM('item', 'assembly', 'group', 'allowance', 'note', 'exclusion', 'assumption');--> statement-breakpoint
ALTER TABLE "line_items" ALTER COLUMN "section" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "line_items" ADD COLUMN "parent_id" uuid;--> statement-breakpoint
ALTER TABLE "line_items" ADD COLUMN "type" "line_item_type" DEFAULT 'item' NOT NULL;--> statement-breakpoint
ALTER TABLE "line_items" ADD COLUMN "optional" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "line_items" ADD CONSTRAINT "line_items_parent_id_line_items_id_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."line_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "line_items_parent_id_idx" ON "line_items" USING btree ("parent_id");--> statement-breakpoint

-- The prose, converted. One node per non-empty line: the old field was a
-- textarea a contractor put one exclusion per line into, and a single node
-- holding the whole blob would be a paragraph he can only edit as a paragraph.
-- Positions continue from the end of each quote's existing rows, so converted
-- text lands after the priced work rather than interleaved with it.
INSERT INTO "line_items" (
  "quote_id", "type", "section", "description",
  "quantity", "sell_price_cents", "taxable", "optional", "position", "source"
)
SELECT
  q."id",
  'exclusion'::line_item_type,
  NULL,
  btrim(part.line, E' \t\r\n'),
  1,
  0,
  false,
  false,
  COALESCE(m.max_position, -1)
    + row_number() OVER (PARTITION BY q."id" ORDER BY part.ord),
  'typed'::line_item_source
FROM "quotes" q
CROSS JOIN LATERAL unnest(string_to_array(q."exclusions", E'\n'))
  WITH ORDINALITY AS part(line, ord)
LEFT JOIN LATERAL (
  SELECT max(li."position") AS max_position
  FROM "line_items" li
  WHERE li."quote_id" = q."id"
) m ON true
WHERE q."exclusions" IS NOT NULL
  AND btrim(part.line, E' \t\r\n') <> '';--> statement-breakpoint

-- Assumptions second, so they sit after the exclusions the statement above
-- just wrote. An assumption is a condition the price depends on; an exclusion
-- is work the price does not cover — separate rows, separate headings, because
-- they are not the same sentence.
INSERT INTO "line_items" (
  "quote_id", "type", "section", "description",
  "quantity", "sell_price_cents", "taxable", "optional", "position", "source"
)
SELECT
  q."id",
  'assumption'::line_item_type,
  NULL,
  btrim(part.line, E' \t\r\n'),
  1,
  0,
  false,
  false,
  COALESCE(m.max_position, -1)
    + row_number() OVER (PARTITION BY q."id" ORDER BY part.ord),
  'typed'::line_item_source
FROM "quotes" q
CROSS JOIN LATERAL unnest(string_to_array(q."assumptions", E'\n'))
  WITH ORDINALITY AS part(line, ord)
LEFT JOIN LATERAL (
  SELECT max(li."position") AS max_position
  FROM "line_items" li
  WHERE li."quote_id" = q."id"
) m ON true
WHERE q."assumptions" IS NOT NULL
  AND btrim(part.line, E' \t\r\n') <> '';--> statement-breakpoint

ALTER TABLE "line_items" ADD CONSTRAINT "line_items_bucket_matches_type" CHECK (("line_items"."type" in ('item', 'allowance')) = ("line_items"."section" is not null));--> statement-breakpoint
ALTER TABLE "quotes" DROP COLUMN "exclusions";--> statement-breakpoint
ALTER TABLE "quotes" DROP COLUMN "assumptions";
