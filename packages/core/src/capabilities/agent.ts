import { tool, type ToolSet } from "ai";
import { z } from "zod";
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
  options: { organizationId: string; only?: (name: string) => boolean },
): ToolSet {
  if (ctx.principal.surface !== "agent")
    throw new Error("Agent tools need an `agent` principal.");
  const tools: ToolSet = {};
  for (const capability of listCapabilities("agent")) {
    if (capability.name === "listOrganizations") continue;
    if (options.only && !options.only(capability.name)) continue;
    if (ctx.principal.access === "read" && capability.kind !== "query")
      continue;
    const scoped =
      capability.input instanceof z.ZodObject &&
      "organizationId" in capability.input.shape;
    tools[capability.name] = tool({
      description: capability.description,
      // The authenticated conversation owns the organization. Omit it from
      // model inputs and overwrite any old transcript/client value on execution.
      inputSchema: scoped
        ? z
            .object((capability.input as z.ZodObject).shape)
            .omit({ organizationId: true })
            .superRefine((input, ctx) => {
              // Rebuild the exposed shape because Zod cannot omit fields
              // from refined objects; validate with the original refinements.
              const result = capability.input.safeParse({
                ...input,
                organizationId: options.organizationId,
              });
              if (!result.success)
                for (const issue of result.error.issues)
                  ctx.addIssue({ ...issue });
            })
        : capability.input,
      needsApproval:
        capability.kind === "command" &&
        (capability.decision === true || capability.destructive === true),
      execute: async (input: unknown) => {
        try {
          return {
            ok: true,
            result: await invoke(
              ctx,
              capability.name,
              scoped
                ? {
                    ...(input as object),
                    organizationId: options.organizationId,
                  }
                : input,
            ),
          };
        } catch (error) {
          return { ok: false, error: toCapabilityError(error).toJSON() };
        }
      },
    });
  }
  return tools;
}
