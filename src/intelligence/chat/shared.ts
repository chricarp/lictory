import type { UIMessage } from "ai";
import { z } from "zod";

// Shared between the assistant route and the chat UI: the clarification tool
// contract and the message type of an Intelligence conversation.

export const ASK_QUESTIONS = "askQuestions";

const choice = z.object({
  value: z
    .string()
    .describe("Stable machine value, e.g. a project or team id."),
  label: z.string().describe("What the person sees."),
  description: z
    .string()
    .nullable()
    .describe("One short line that helps choose, or null."),
});

export const questionSchema = z.object({
  id: z.string().describe("Short key for the answer, e.g. `project`."),
  prompt: z.string().describe("The question, one sentence."),
  description: z
    .string()
    .nullable()
    .describe("Why it matters or what changes with the answer, or null."),
  kind: z
    .enum(["single", "multiple", "text"])
    .describe(
      "single: pick one option; multiple: pick any number; text: free answer.",
    ),
  options: z
    .array(choice)
    .describe("Choices for single/multiple. Empty for text questions."),
  allowOther: z
    .boolean()
    .describe("Let the person type an answer that is not in the options."),
  required: z.boolean().describe("False when the question may be skipped."),
});
export type Question = z.infer<typeof questionSchema>;

export const askQuestionsInput = z.object({
  title: z
    .string()
    .describe("What is being clarified, e.g. `Where should this story go?`."),
  questions: z.array(questionSchema).min(1).max(6),
});
export type AskQuestionsInput = z.infer<typeof askQuestionsInput>;

export const askQuestionsOutput = z.union([
  z.object({
    answers: z.array(
      z.object({
        id: z.string(),
        // Option values chosen, in order.
        values: z.array(z.string()),
        // Labels of the chosen options, so the model does not need to map ids.
        labels: z.array(z.string()),
        // Free text (text questions or an "other" answer).
        text: z.string().nullable(),
        skipped: z.boolean(),
      }),
    ),
  }),
  z.object({ dismissed: z.literal(true) }),
]);
export type AskQuestionsOutput = z.infer<typeof askQuestionsOutput>;

export type ChatDataParts = {
  // Transient: the generated conversation title.
  title: { title: string };
};

export type ChatMetadata = {
  // Time the assistant spent working on this message, summed over every
  // request that continued it (answers and approvals), excluding the time
  // spent waiting for the person.
  workedMs?: number;
};

export type ChatMessage = UIMessage<ChatMetadata, ChatDataParts>;

export type ChatSummary = {
  id: string;
  title: string | null;
  pinned: boolean;
  createdAt: string;
  updatedAt: string;
  preview: string | null;
};
