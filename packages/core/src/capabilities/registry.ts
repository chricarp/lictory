import * as s from "@lictory/core/db/schema";
import { accessTokenCapabilities } from "@lictory/core/capabilities/access-tokens";
import { attachmentCapabilities } from "@lictory/core/capabilities/attachments";
import { brandingCapabilities } from "@lictory/core/capabilities/branding";
import {
  CapabilityError,
  type AnyCapability,
  type CapabilityContext,
  type Surface,
} from "@lictory/core/capabilities/core";
import { deliveryCapabilities } from "@lictory/core/capabilities/delivery";
import { toCapabilityError } from "@lictory/core/capabilities/errors";
import { intelligenceCapabilities } from "@lictory/core/capabilities/intelligence";
import { notificationCapabilities } from "@lictory/core/capabilities/notifications";
import { workspaceCapabilities } from "@lictory/core/capabilities/workspace";

// The catalog of everything a person can do in Lictory. Each surface (web
// routes, the MCP server, the embedded agent) lists and invokes from here.
export const capabilities: readonly AnyCapability[] = [
  ...workspaceCapabilities,
  ...notificationCapabilities,
  ...deliveryCapabilities,
  ...intelligenceCapabilities,
  ...attachmentCapabilities,
  ...brandingCapabilities,
  ...accessTokenCapabilities,
];

const byName = new Map<string, AnyCapability>();
for (const capability of capabilities) {
  if (byName.has(capability.name))
    throw new Error(`Duplicate capability ${capability.name}.`);
  byName.set(capability.name, capability);
}

export function listCapabilities(surface: Surface) {
  return capabilities.filter((c) => c.surfaces.includes(surface));
}

export function getCapability(name: string, surface: Surface) {
  const capability = byName.get(name);
  return capability?.surfaces.includes(surface) ? capability : undefined;
}

function organizationOf(input: unknown): string | null {
  if (!input || typeof input !== "object") return null;
  const value = input as {
    organizationId?: unknown;
    scope?: { organizationId?: unknown };
  };
  const id = value.organizationId ?? value.scope?.organizationId;
  return typeof id === "string" ? id : null;
}

async function audit(
  ctx: CapabilityContext,
  record: {
    capability: string;
    organizationId: string | null;
    outcome: string;
    mutationId: string | null;
    durationMs: number;
  },
) {
  const values = {
    userId: ctx.principal.userId,
    surface: ctx.principal.surface,
    tokenId: ctx.principal.tokenId ?? null,
    client: ctx.principal.client?.slice(0, 200) ?? null,
    ...record,
  };
  try {
    await ctx.db.insert(s.capabilityInvocation).values(values);
  } catch {
    try {
      // An organization id that does not exist (or was mistyped) still leaves
      // an audit record of the attempt.
      await ctx.db
        .insert(s.capabilityInvocation)
        .values({ ...values, organizationId: null });
    } catch (error) {
      console.error(
        JSON.stringify({
          event: "capability.audit_failed",
          capability: record.capability,
          error: error instanceof Error ? error.message : String(error),
        }),
      );
    }
  }
}

// Validates, authorizes the surface and token, runs the capability and
// normalizes every failure to a CapabilityError. Domain authorization
// (membership, application role, organization-role capabilities) happens in
// the domain services, identically for every surface.
export async function invoke(
  ctx: CapabilityContext,
  name: string,
  rawInput: unknown,
): Promise<unknown> {
  const start = Date.now();
  const capability = getCapability(name, ctx.principal.surface);
  let organizationId: string | null = null;
  let mutationId: string | null = null;
  let outcome = "ok";
  try {
    if (!capability)
      throw new CapabilityError("unavailable", `Unknown operation “${name}”.`);
    if (capability.kind === "command" && ctx.principal.access === "read")
      throw new CapabilityError(
        "forbidden",
        "This access token is read-only. Create a token with write access to make changes.",
      );
    organizationId = organizationOf(rawInput);
    const input = capability.input.parse(rawInput ?? {});
    const output = await capability.run(ctx, input);
    if (output && typeof output === "object" && "mutationId" in output)
      mutationId = String(output.mutationId);
    return output;
  } catch (error) {
    const normalized = toCapabilityError(error);
    outcome = normalized.category;
    if (normalized.category === "server")
      console.error(
        JSON.stringify({
          event: "capability.error",
          capability: name,
          surface: ctx.principal.surface,
          user: ctx.principal.userId,
          organization: organizationId,
          error:
            error instanceof Error
              ? { name: error.name, message: error.message, stack: error.stack }
              : String(error),
        }),
      );
    ctx.effects.trackFailure(name, error);
    throw normalized;
  } finally {
    if (ctx.principal.surface !== "web")
      await audit(ctx, {
        capability: name.slice(0, 120),
        organizationId,
        outcome,
        mutationId,
        durationMs: Date.now() - start,
      });
  }
}
