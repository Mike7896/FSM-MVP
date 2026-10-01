import { z } from "zod";
import { scopeNodeSchema, scopeTreeSchema } from "./quote";

const changeScopeSchema = z.array(scopeNodeSchema.extend({
  referencesNodeId: z.uuid().nullable().optional(),
  referenceKind: z.enum(["deletes", "settles"]).nullable().optional(),
  sellPriceCents: z.number().int().min(-100_000_000).max(100_000_000),
})).max(500).superRefine((rows, ctx) => {
  const parsed = scopeTreeSchema.safeParse(rows.map(row => ({ ...row, sellPriceCents: Math.abs(row.sellPriceCents) })));
  if (!parsed.success) for (const issue of parsed.error.issues) ctx.addIssue({ code: "custom", path: issue.path, message: issue.message });
  if (rows.some(row => row.optional)) ctx.addIssue({ code: "custom", message: "Price only the agreed change; remove optional rows before saving." });
});

export const changeOrderSaveSchema = z.object({
  id: z.uuid(),
  parentContractId: z.uuid(),
  title: z.string().trim().max(200).default(""),
  summary: z.string().trim().max(8000).default(""),
  scope: changeScopeSchema,
  taxRate: z.number().min(0).max(1).nullable().default(null),
  timeImpactDays: z.number().int().min(-3650).max(3650).default(0),
  billingMode: z.enum(["next_draw", "supplemental"]).default("next_draw"),
  revision: z.string().optional(),
  requestId: z.uuid().optional(),
});
export type ChangeOrderSave = z.infer<typeof changeOrderSaveSchema>;
export const changeOrderSendSchema = z.object({
  revision: z.string(),
  printedName: z.string().trim().min(1).max(160),
  consented: z.literal(true),
  email: z.email().optional(),
});
export const changeOrderDecisionSchema = z.object({
  hash: z.string().length(64),
  decision: z.enum(["approve", "decline"]),
  printedName: z.string().trim().max(160).default(""),
  consented: z.boolean().default(false),
});
