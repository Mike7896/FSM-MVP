import { z } from "zod";

export const releaseInput = z.object({
  version: z.string().trim().regex(/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/, "Use a version such as 0.1.0."),
  title: z.string().trim().min(1).max(140),
  items: z.array(z.object({ kind: z.enum(["new", "better", "fixed"]), text: z.string().trim().min(1).max(2000) })).min(1).max(50),
});
