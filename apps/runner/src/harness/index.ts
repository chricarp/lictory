import type { HarnessId } from "@lictory/core/factory/protocol";
import type { RunnerConfig } from "@lictory/runner/config";
import { claudeCode } from "@lictory/runner/harness/claude-code";
import { codex } from "@lictory/runner/harness/codex";
import { lictoryHarness } from "@lictory/runner/harness/lictory";
import type { AgentHarness } from "@lictory/runner/harness/types";

// The harnesses this runner can run. OpenCode and Gemini CLI are known to
// the server but have no adapter yet, so a runner never reports them.
export const harnesses: AgentHarness[] = [claudeCode, codex, lictoryHarness];

export async function detectHarnesses(
  available: AgentHarness[],
  config: RunnerConfig,
) {
  const found = await Promise.all(
    available.map(async (harness) => ({
      harness,
      version: await harness.detect(config).catch(() => null),
    })),
  );
  return found
    .filter((f) => f.version !== null)
    .map((f) => ({ id: f.harness.id, version: f.version, harness: f.harness }));
}

export type Detected = Awaited<ReturnType<typeof detectHarnesses>>;

export function harnessFor(detected: Detected, id: HarnessId) {
  return detected.find((d) => d.id === id)?.harness ?? null;
}
