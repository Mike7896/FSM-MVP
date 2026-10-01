import { z } from "zod";

export const createInfoRequestSchema = z.object({
  id: z.uuid(),
  questions: z.array(z.object({ id: z.uuid(), prompt: z.string().trim().min(1).max(500) })).max(10),
  photoPrompt: z.string().trim().max(500).default(""),
  note: z.string().trim().max(2000).default(""),
}).refine(body => body.questions.length > 0 || body.photoPrompt.length > 0, "Add a question or ask for a photo.")
  .refine(body => new Set(body.questions.map(q => q.id)).size === body.questions.length, "Questions must have unique identifiers.");

export const answerInfoRequestSchema = z.object({
  answers: z.array(z.object({ questionId: z.uuid(), text: z.string().trim().min(1).max(4000) })).max(10),
  photoPaths: z.array(z.string().max(500)).max(3).default([]),
});

export function validateInfoAnswers(questions: { id: string }[], answers: { questionId: string; text: string }[], photoPrompt: string | null, paths: string[]) {
  const ids = new Set(answers.map(a => a.questionId));
  if (ids.size !== answers.length || answers.length !== questions.length || questions.some(q => !ids.has(q.id))) return "Answer each question before sending your reply.";
  if (photoPrompt && paths.length === 0) return "Attach at least one photo before sending your reply.";
  if (!photoPrompt && paths.length > 0) return "This request doesn't ask for photos.";
  if (new Set(paths).size !== paths.length) return "Attach each photo only once.";
  return null;
}

export const deliverInfoRequestSchema = z.discriminatedUnion("channel", [
  z.object({ channel: z.literal("link") }),
  z.object({ channel: z.literal("email"), to: z.email() }),
]);
