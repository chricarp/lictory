import { tool, type ToolSet } from "ai";
import type { CapabilityContext } from "@lictory/core/capabilities/core";
import { toCapabilityError } from "@lictory/core/capabilities/errors";
import { invoke, listCapabilities } from "@lictory/core/capabilities/registry";

// Exposes the capability registry to the embedded Lictory agent as AI SDK
// tools, without MCP. The agent acts for the signed-in person (surface
// `agent`), so it can never do more than that person can in the browser.
// Decisions and destructive commands need the person's approval before they
// run (`needsApproval`); failures are returned to the model as data so it can
// explain or correct them.
export function agentTools(
  ctx: CapabilityContext,
  options: { only?: (name: string) => boolean } = {},
): ToolSet {
  if (ctx.principal.surface !== "agent")
    throw new Error("Agent tools need an `agent` principal.");
  const tools: ToolSet = {};
  for (const capability of listCapabilities("agent")) {
    if (options.only && !options.only(capability.name)) continue;
    if (ctx.principal.access === "read" && capability.kind !== "query")
      continue;
    tools[capability.name] = tool({
      description: capability.description,
      inputSchema: capability.input,
      needsApproval:
        capability.kind === "command" &&
        (capability.decision === true || capability.destructive === true),
      execute: async (input: unknown) => {
        try {
          return {
            ok: true,
            result: await invoke(ctx, capability.name, input),
          };
        } catch (error) {
          return { ok: false, error: toCapabilityError(error).toJSON() };
        }
      },
    });
  }
  return tools;
}
