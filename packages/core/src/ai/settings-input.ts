// What the admin console and `lictory ai setup` send to change the AI
// provider settings, and how a change combines with what is stored. Pure:
// domain/ai-settings.ts stores the result.
import { z } from "zod";
import {
  AI_TIMEOUT_SECONDS_RANGE,
  type AiSettings,
  type ProviderSettings,
} from "@lictory/core/ai/provider-settings";
import {
  secretFields,
  textProviderOf,
  transcriptionProviderOf,
  type AiField,
} from "@lictory/core/contracts/ai-provider";

const field = z.string().trim().max(20_000).optional();
const providerInput = z.object({
  provider: z.string().trim().min(1).max(60),
  model: field,
  baseUrl: field,
  region: field,
  project: field,
  location: field,
  structuredOutput: field,
  // Secrets: absent keeps the stored value (same provider only), "" clears.
  apiKey: field,
  accessKeyId: field,
  secretAccessKey: field,
  tenantId: field,
  clientId: field,
  clientSecret: field,
});
export const aiSettingsInput = z.object({
  text: providerInput.nullable(),
  // "default": live OpenAI dictation when text goes to OpenAI, otherwise off.
  transcription: z.union([providerInput, z.literal("default")]).nullable(),
  timeoutSeconds: z
    .number()
    .int()
    .min(AI_TIMEOUT_SECONDS_RANGE.minimum)
    .max(AI_TIMEOUT_SECONDS_RANGE.maximum)
    // null: back to the default; absent: keep what is stored.
    .nullable()
    .optional(),
});
export type AiSettingsInput = z.infer<typeof aiSettingsInput>;

export const allFields: AiField[] = [
  "apiKey",
  "baseUrl",
  "model",
  "region",
  "project",
  "location",
  "accessKeyId",
  "secretAccessKey",
  "tenantId",
  "clientId",
  "clientSecret",
  "structuredOutput",
];
export const isSecret = (f: AiField) => secretFields.includes(f);

/**
 * The settings a change would produce: new values over the stored ones. A
 * secret left out keeps the stored one only for the same provider; "" clears
 * it. Fields a provider does not use are dropped.
 */
export function mergeSettings(
  stored: AiSettings | null,
  input: AiSettingsInput,
): AiSettings {
  const part = (
    name: "text" | "transcription",
    next: z.infer<typeof providerInput> | null,
    previous: ProviderSettings | null | undefined,
  ): ProviderSettings | null => {
    if (!next) return null;
    const spec =
      name === "text"
        ? textProviderOf(next.provider)
        : transcriptionProviderOf(next.provider);
    const result: ProviderSettings = { provider: next.provider };
    for (const f of allFields) {
      if (spec && !spec.fields[f]) continue;
      const value = next[f];
      if (value === undefined) {
        if (isSecret(f) && previous?.provider === next.provider && previous[f])
          result[f] = previous[f];
        continue;
      }
      if (value !== "") result[f] = value;
    }
    return result;
  };
  return {
    text: part("text", input.text, stored?.text),
    transcription:
      input.transcription === "default"
        ? undefined
        : part(
            "transcription",
            input.transcription,
            stored?.transcription ?? undefined,
          ),
    timeoutSeconds:
      input.timeoutSeconds === null
        ? undefined
        : (input.timeoutSeconds ?? stored?.timeoutSeconds),
  };
}
