// Startup rules for Lictory Intelligence (ai/provider-settings.ts and the
// dictation settings), reported with the other configuration problems: an
// explicit but incomplete provider stops the API and the worker instead of
// leaving AI silently off or sending content somewhere else.
import type { ConfigurationRule } from "@lictory/core/config/validate";
import {
  aiProviderRule,
  transcriptionRule,
} from "@lictory/core/ai/provider-settings";

export const aiRules: ConfigurationRule[] = [aiProviderRule, transcriptionRule];
