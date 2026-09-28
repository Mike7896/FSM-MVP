import { z } from "zod";

/**
 * `GET /api/v1/search` — one box, every object.
 *
 * `kind` is how a group asks for its own next page. Left out, every group's
 * first page comes back at once, which is the one round trip the modal makes
 * when somebody stops typing.
 */
export const searchKindValues = [
  "customers",
  "jobs",
  "quotes",
  "contracts",
  "change-orders",
  "invoices",
  "tasks",
] as const;

export const searchQuerySchema = z.object({
  q: z.string().trim().min(1, "Type something to search for.").max(120),
  kind: z.enum(searchKindValues).optional(),
  /** Five is what fits in a group before the list stops being scannable. */
  limit: z.coerce.number().int().min(1).max(25).default(5),
  offset: z.coerce.number().int().min(0).max(5000).default(0),
});

export type SearchQueryInput = z.infer<typeof searchQuerySchema>;
