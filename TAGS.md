# Tags

Jobs, quotes, and customers share an organization-scoped catalog of named, colored tags. Open **Manage tags** on a list or in a record's **Add tags** picker to create, rename, recolor, or delete a tag. Deleting a tag removes its assignments, with confirmation, and leaves the underlying records intact.

Each list supports **Match any tag**, **Match all tags**, and **Untagged only**. Filters combine with text search, run before pagination, and persist in the URL and when switching quote views. Tags are internal metadata and do not modify quote content, signatures, or customer-facing documents.

## API

All endpoints require an authenticated organization member. Multi-organization callers send `X-Organization-Id`.

- `GET /api/v1/tags`: list the organization's tags.
- `POST /api/v1/tags`: create with `{ name, color }`.
- `PATCH /api/v1/tags`: rename/recolor with `{ id, name, color }`.
- `DELETE /api/v1/tags`: delete with `{ id }`.
- `PUT /api/v1/tags/assignments`: assign/unassign with `{ entity: "job" | "quote" | "customer", recordId, tagId, assigned: boolean }`.
- Existing jobs, quotes, and customers list endpoints accept comma-separated UUIDs in `tags` and `tagMode=any|all|untagged`.

Names are trimmed, 1–40 characters, and unique without regard to case within an organization. Colors: slate, blue, violet, pink, red, orange, amber, green, teal. Up to 20 distinct tags can participate in a filter. Changes to assignments are individually idempotent so changing one label does not overwrite a teammate's other labels.

## Database and verification

Migration `0027_tags.sql` creates the catalog and assignments, cascading foreign keys, uniqueness constraints, read policies, and a database trigger rejecting cross-organization assignments and non-quote document targets. Writes go through authenticated API routes; direct authenticated database writes are not permitted by the new RLS policies.

Run `npm run db:migrate`, then `npm run tags:check`. The integration check creates isolated fixtures inside a transaction and rolls them all back. It covers names/colors, duplicate labels, assignment idempotency, all three entity types and filter modes, tenant isolation, quote-type constraints, updates, and cascading deletion.
