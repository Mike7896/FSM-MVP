CREATE TYPE "public"."scope_breakdown" AS ENUM('show', 'hide');--> statement-breakpoint
CREATE TYPE "public"."scope_detail" AS ENUM('top', 'all');--> statement-breakpoint
ALTER TABLE "quote_details" ADD COLUMN "scope_detail" "scope_detail";--> statement-breakpoint
ALTER TABLE "scope_nodes" ADD COLUMN "breakdown" "scope_breakdown";--> statement-breakpoint
ALTER TABLE "scope_nodes" ADD CONSTRAINT "scope_nodes_breakdown_container" CHECK ("breakdown" IS NULL OR "node_type" IN ('group', 'assembly'));
