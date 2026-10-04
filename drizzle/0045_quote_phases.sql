CREATE TYPE "public"."phase_split" AS ENUM('scope', 'percent');--> statement-breakpoint
ALTER TABLE "quote_details" ADD COLUMN "phase_split" "phase_split";--> statement-breakpoint
ALTER TABLE "scope_nodes" ADD COLUMN "phase_key" text;--> statement-breakpoint
ALTER TABLE "draw_schedule" ADD COLUMN "phase_key" text;