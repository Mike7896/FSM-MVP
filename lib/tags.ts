import { z } from "zod";

export const TAG_COLORS = {
  slate: "#94a3b8",
  blue: "#60a5fa",
  violet: "#a78bfa",
  pink: "#f472b6",
  red: "#f87171",
  orange: "#fb923c",
  amber: "#fbbf24",
  green: "#4ade80",
  teal: "#2dd4bf",
} as const;
export type Tag = { id: string; name: string; color: keyof typeof TAG_COLORS };
export const entitySchema = z.enum(["job", "quote", "customer", "task"]);
export type TagEntity = z.infer<typeof entitySchema>;
export const tagSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, "Give the tag a name.")
    .max(40)
    .regex(/^[^\p{Cc}]+$/u, "Use a single-line name."),
  color: z.enum(Object.keys(TAG_COLORS) as [Tag["color"], ...Tag["color"][]]),
});
export const tagFilterShape = {
  tags: z.string().max(800).optional(),
  tagMode: z.enum(["any", "all", "untagged"]).optional(),
};
export type TagFilter = { tags?: string; tagMode?: "any" | "all" | "untagged" };
export function parseTagFilter(
  params: Record<string, string | string[] | undefined>,
): TagFilter {
  return {
    tags:
      typeof params.tags === "string" ? params.tags.slice(0, 800) : undefined,
    tagMode:
      params.tagMode === "all" || params.tagMode === "untagged"
        ? params.tagMode
        : "any",
  };
}
export function tagIds(value?: string) {
  return [
    ...new Set(
      (value ?? "").split(",").filter((id) => z.uuid().safeParse(id).success),
    ),
  ].slice(0, 20);
}
