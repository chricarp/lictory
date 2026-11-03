import * as s from "@lictory/core/db/schema";
import { and, eq, or, sql } from "drizzle-orm";
import { accessTokenCapabilities } from "@lictory/core/capabilities/access-tokens";
import { productKnowledgeCapabilities } from "@lictory/core/capabilities/product-knowledge";
import { attachmentCapabilities } from "@lictory/core/capabilities/attachments";
import { auditCapabilities } from "@lictory/core/capabilities/audit";
import { exportCapabilities } from "@lictory/core/capabilities/export";
import { brandingCapabilities } from "@lictory/core/capabilities/branding";
import {
  CapabilityError,
  type AnyCapability,
  type CapabilityContext,
  type Surface,
} from "@lictory/core/capabilities/core";
import { deliveryCapabilities } from "@lictory/core/capabilities/delivery";
import {
  assertHumanOnlyMetadata,
  humanOnlyCapability,
  humanOnlyRefusal,
} from "@lictory/core/capabilities/human-only";
import { toCapabilityError } from "@lictory/core/capabilities/errors";
import { assertTwoFactorSatisfied } from "@lictory/core/domain/two-factor-policy";
import { intakeCapabilities } from "@lictory/core/capabilities/intake";
import { intelligenceCapabilities } from "@lictory/core/capabilities/intelligence";
import { notificationCapabilities } from "@lictory/core/capabilities/notifications";
import { securityCapabilities } from "@lictory/core/capabilities/security";
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
  ...securityCapabilities,
  ...auditCapabilities,
  ...exportCapabilities,
  ...productKnowledgeCapabilities,
  ...intakeCapabilities,
  humanOnlyCapability(() => capabilities),
];
assertHumanOnlyMetadata(capabilities);

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

// Agents calling an operation that deliberately stays in the browser get the
// reason and where the person does it, rather than "unknown".
export function humanOnlyError(name: string) {
  return humanOnlyRefusal(capabilities, name);
}

function organizationOf(input: unknown): string | null {
  if (!input || typeof input !== "object") return null;
  const id = (input as { organizationId?: unknown }).organizationId;
  return typeof id === "string" ? id : null;
}

// MCP clients can use the readable slug instead of copying an opaque id.
// Only memberships are searched: unknown and inaccessible organizations have
// the same response. Domain services still authorize inside their transactions.
function organizationMatches(
  ctx: CapabilityContext,
  reference: string,
  acceptSlug: boolean,
) {
  return ctx.db
    .selectDistinct({ id: s.organization.id })
    .from(s.organization)
    .innerJoin(
      s.member,
      and(
        eq(s.member.organizationId, s.organization.id),
        eq(s.member.userId, ctx.principal.userId),
      ),
    )
    .where(
      acceptSlug
        ? or(
            eq(s.organization.id, reference),
            eq(s.organization.slug, reference),
          )
        : eq(s.organization.id, reference),
    )
    .limit(2);
}

async function resolveMcpOrganization(ctx: CapabilityContext, input: unknown) {
  if (!input || typeof input !== "object" || !("organizationId" in input))
    return input;
  const reference = input.organizationId;
  if (typeof reference !== "string") return input;
  const matches = await organizationMatches(ctx, reference, true);
  if (!matches.length)
    throw new CapabilityError(
      "forbidden",
      `Organization “${reference}” is unavailable or you are not a member. Call listOrganizations and use an id or slug from its results.`,
    );
  if (matches.length > 1)
    throw new CapabilityError(
      "validation",
      "This organization reference matches more than one organization. Call listOrganizations and use an unambiguous id or slug.",
    );
  return {
    ...input,
    organizationId: matches[0]!.id,
    // Organization notification preferences use the organization as scopeId.
    ...("scope" in input &&
    input.scope === "organization" &&
    "scopeId" in input &&
    input.scopeId === reference
      ? { scopeId: matches[0]!.id }
      : {}),
  };
}

async function audit(
  ctx: CapabilityContext,
  record: {
    capability: string;
    organizationId: string | null;
    organizationReference: string | null;
    outcome: string;
    mutationId: string | null;
    durationMs: number;
  },
) {
  try {
    const {
      organizationId: resolvedId,
      organizationReference,
      ...fields
    } = record;
    // Once execution has resolved a reference, keep that exact organization
    // even if its slug changes before the audit is written.
    const reference = resolvedId ?? organizationReference;
    const matches =
      reference === null
        ? null
        : organizationMatches(
            ctx,
            reference,
            resolvedId === null && ctx.principal.surface === "mcp",
          ).as("audit_organizations");
    // Resolve even invalid calls, without inserting raw references or relying
    // on FK errors. Unknown, inaccessible and ambiguous references stay null.
    // Keep the lookup in the insert to avoid another database round trip.
    const organizationId = matches
      ? sql`(${ctx.db
          .select({
            id: sql`case when count(*) = 1 then min(${matches.id}) else null end`,
          })
          .from(matches)})`
      : null;
    await ctx.db.insert(s.capabilityInvocation).values({
      userId: ctx.principal.userId,
      surface: ctx.principal.surface,
      tokenId: ctx.principal.tokenId ?? null,
      client: ctx.principal.client?.slice(0, 200) ?? null,
      ...fields,
      organizationId,
    });
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
      throw (
        humanOnlyError(name) ??
        new CapabilityError("unavailable", `Unknown operation “${name}”.`)
      );
    if (capability.kind === "command" && ctx.principal.access === "read")
      throw new CapabilityError(
        "forbidden",
        "This access token is read-only. Create a token with write access to make changes.",
      );
    const parsed = capability.input.parse(rawInput ?? {});
    const input =
      ctx.principal.surface === "mcp"
        ? await resolveMcpOrganization(ctx, parsed)
        : parsed;
    organizationId = organizationOf(input);
    // An organization that requires two-factor holds members without it,
    // on every surface, before any capability runs (domain services check
    // again through `authorize`).
    if (organizationId)
      await assertTwoFactorSatisfied(
        ctx.db,
        ctx.principal.userId,
        organizationId,
      );
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
        organizationReference: organizationOf(rawInput),
        outcome,
        mutationId,
        durationMs: Date.now() - start,
      });
  }
}
