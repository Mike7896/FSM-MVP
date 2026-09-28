ALTER TABLE "office_defaults" ALTER COLUMN "document_preset" SET DEFAULT 'plain';--> statement-breakpoint

-- Document branding's presets were named for a mood — plain · classic · bold —
-- and are now named for what actually changes at the top of the document:
-- plain · with_logo · bold_header (wireframe 94 · 34c). Existing rows are
-- remapped rather than reset, because a business that picked a look should keep
-- the nearest one rather than silently reverting to the default.
UPDATE "office_defaults" SET "document_preset" = 'with_logo' WHERE "document_preset" = 'classic';--> statement-breakpoint
UPDATE "office_defaults" SET "document_preset" = 'bold_header' WHERE "document_preset" = 'bold';
