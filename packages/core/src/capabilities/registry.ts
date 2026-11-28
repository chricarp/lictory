import * as s from "@lictory/core/db/schema";
import type { CapabilityInvocationDetail } from "@lictory/core/db/agent-schema";
import { and, eq, or, sql } from "drizzle-orm";
import { accessTokenCapabilities } from "@lictory/core/capabilities/access-tokens";
import { productKnowledgeCapabilities } from "@lictory/core/capabilities/product-knowledge";
import { attachmentCapabilities } from "@lictory/core/capabilities/attachments";
import { auditCapabilities } from "@lictory/core/capabilities/audit";
import { exportCapabilities } from "@lictory/core/capabilities/export";
import { organizationDeletionCapabilities } from "@lictory/core/capabilities/organization-deletion";
import { brandingCapabilities } from "@lictory/core/capabilities/branding";
import { z } from "zod";
import {
  CapabilityError,
  type AnyCapability,
  type CapabilityContext,
  type Principal,
  type Surface,
} from "@lictory/core/capabilities/core";
import { deliveryCapabilities } from "@lictory/core/capabilities/delivery";
import { codeCapabilities } from "@lictory/core/capabilities/code";
import {
  assertHumanOnlyMetadata,
  humanOnlyCapability,
  humanOnlyRefusal,
  personDecisionRefusal,
} from "@lictory/core/capabilities/human-only";
import { toCapabilityError } from "@lictory/core/capabilities/errors";
import { assertOrganizationAccess } from "@lictory/core/domain/organization-access";
import { intakeCapabilities } from "@lictory/core/capabilities/intake";
import { intelligenceCapabilities } from "@lictory/core/capabilities/intelligence";
import { notificationCapabilities } from "@lictory/core/capabilities/notifications";
import { securityCapabilities } from "@lictory/core/capabilities/security";
import { spaceCapabilities } from "@lictory/core/capabilities/spaces";
import { knowledgeCapabilities } from "@lictory/core/capabilities/knowledge";
import { decisionCapabilities } from "@lictory/core/capabilities/decisions";
import {
  commandCapabilities,
  workspaceCapabilities,
} from "@lictory/core/capabilities/workspace";
import { factoryCapabilities } from "@lictory/core/capabilities/factory";
import {
  assertAgentOrganization,
  assertAgentProject,
} from "@lictory/core/factory/authority";
import { claimCapabilities } from "@lictory/core/capabilities/claims";
import { channelCapabilities } from "@lictory/core/capabilities/channels";
import { slackCapabilities } from "@lictory/core/capabilities/slack";
import {
  agentEventCapabilities,
  agentEventGlobalCapabilities,
} from "@lictory/core/capabilities/agent-events";

// The catalog of everything a person can do in Lictory. Each surface (web
// routes, the MCP server, the embedded agent) lists and invokes from here.
export const capabilities: readonly AnyCapability[] = [
  ...workspaceCapabilities,
  ...spaceCapabilities,
  ...knowledgeCapabilities,
  ...decisionCapabilities,
  ...notificationCapabilities,
  ...deliveryCapabilities,
  ...intelligenceCapabilities,
  ...attachmentCapabilities,
  ...brandingCapabilities,
  ...accessTokenCapabilities,
  ...securityCapabilities,
  ...auditCapabilities,
  ...exportCapabilities,
  ...organizationDeletionCapabilities,
  ...productKnowledgeCapabilities,
  ...intakeCapabilities,
  ...claimCapabilities,
  ...factoryCapabilities,
  ...channelCapabilities,
  ...codeCapabilities,
  ...slackCapabilities,
  ...agentEventCapabilities,
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

// What this principal may call, which is what MCP lists: read tokens only
// reach queries; a Factory agent never reaches a person's decision, and an
// agent limited to some projects never reaches an operation that cannot name
// one of them (it would always be refused, see assertAgentScope).
export function capabilitiesFor(principal: Principal) {
  return listCapabilities(principal.surface).filter(
    (c) =>
      (principal.access !== "read" || c.kind === "query") &&
      !(principal.agent && c.decision) &&
      !(principal.agent?.projectIds && alwaysOutsideProjects(c)),
  );
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

// The subject a call names, for its owner to read in the agent's activity:
// the first of these fields the caller passed, as it named it (a key such as
// PAY-142 or an id). Only identifiers, never the call's content.
const targetFields = [
  "workItemId",
  "sessionId",
  "pullRequestId",
  "claimId",
  "reviewId",
  "threadId",
  "suggestionId",
  "specificationId",
  "pageId",
  "channelId",
  "projectId",
  "agentId",
  "runnerId",
  // getWorkItem's key ("PAY-142").
  "key",
] as const;

export function invocationTarget(input: unknown) {
  if (!input || typeof input !== "object") return undefined;
  for (const field of targetFields) {
    const value = (input as Record<string, unknown>)[field];
    if (typeof value === "string" && value.trim())
      return { field, id: value.trim().slice(0, 120) };
  }
  return undefined;
}

// What a refused call was told, bounded. A server failure's message is
// internal and stays in the server's log.
export function invocationDetail(
  input: unknown,
  error: CapabilityError | null,
): CapabilityInvocationDetail | null {
  const target = invocationTarget(input);
  const refusal =
    error && error.category !== "server"
      ? {
          message: error.message.slice(0, 500),
          ...(error.details.kind ? { kind: error.details.kind } : {}),
        }
      : {};
  return target || error ? { ...(target ? { target } : {}), ...refusal } : null;
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
    detail: CapabilityInvocationDetail | null;
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

// A Factory agent acts only in its organization and, with a project
// allowlist, only where its scope can be shown (docs/internals/factory.md).
// Capabilities an agent may call without naming its organization:
const agentGlobal = new Set([
  "listOrganizations",
  "listHumanOnlyOperations",
  ...agentEventGlobalCapabilities,
]);
// Capabilities that check a project-limited agent's scope themselves: every
// workspace command (`applyMutation`) and the Factory's own.
const agentScoped = new Set([
  ...agentGlobal,
  ...commandCapabilities.map((c) => c.name),
  ...factoryCapabilities.map((c) => c.name),
]);
async function assertAgentScope(
  ctx: CapabilityContext,
  capability: AnyCapability,
  input: unknown,
) {
  const agent = ctx.principal.agent;
  if (!agent) return;
  const organizationId = organizationOf(input);
  if (!agentGlobal.has(capability.name))
    assertAgentOrganization(agent, organizationId);
  if (!agent.projectIds || !organizationId) return;
  const fields = (input ?? {}) as Record<string, unknown>;
  if (typeof fields.projectId === "string")
    return assertAgentProject(agent, fields.projectId);
  // Claim operations name the claim; its project decides.
  if (typeof fields.claimId === "string") {
    const [claim] = await ctx.db
      .select({ projectId: s.workItemClaim.projectId })
      .from(s.workItemClaim)
      .where(
        and(
          eq(s.workItemClaim.organizationId, organizationId),
          eq(s.workItemClaim.id, fields.claimId),
        ),
      );
    return assertAgentProject(agent, claim?.projectId ?? null);
  }
  // Code operations on one pull request: the projects its repository
  // serves decide (one of them in scope is enough).
  if (typeof fields.pullRequestId === "string" && !fields.workItemId) {
    const projects = await ctx.db
      .select({ projectId: s.codeRepositoryProject.projectId })
      .from(s.codePullRequest)
      .innerJoin(
        s.codeRepositoryProject,
        and(
          eq(
            s.codeRepositoryProject.organizationId,
            s.codePullRequest.organizationId,
          ),
          eq(
            s.codeRepositoryProject.repositoryId,
            s.codePullRequest.repositoryId,
          ),
        ),
      )
      .where(
        and(
          eq(s.codePullRequest.organizationId, organizationId),
          eq(s.codePullRequest.id, fields.pullRequestId),
        ),
      );
    const inScope = projects.find((p) =>
      agent.projectIds!.includes(p.projectId),
    );
    return assertAgentProject(agent, inScope?.projectId ?? null);
  }
  // The calling agent's own claims are inside its scope by construction.
  if (capability.name === "listClaims" && fields.mine === true) return;
  if (typeof fields.workItemId === "string") {
    const [item] = await ctx.db
      .select({ projectId: s.workItem.projectId })
      .from(s.workItem)
      .where(
        and(
          eq(s.workItem.organizationId, organizationId),
          eq(s.workItem.id, fields.workItemId),
        ),
      );
    return assertAgentProject(agent, item?.projectId ?? null);
  }
  const key =
    typeof fields.key === "string"
      ? /^([A-Z][A-Z0-9]{1,9})-\d+$/.exec(fields.key)?.[1]
      : undefined;
  if (key) {
    const [project] = await ctx.db
      .select({ id: s.project.id })
      .from(s.project)
      .where(
        and(
          eq(s.project.organizationId, organizationId),
          eq(s.project.key, key),
        ),
      );
    return assertAgentProject(agent, project?.id ?? null);
  }
  if (!agentScoped.has(capability.name)) assertAgentProject(agent, null);
}

// Inputs assertAgentScope can place inside a project.
const projectFields = [
  "projectId",
  "claimId",
  "pullRequestId",
  "workItemId",
  "key",
];
function alwaysOutsideProjects(capability: AnyCapability) {
  if (agentScoped.has(capability.name)) return false;
  if (!(capability.input instanceof z.ZodObject)) return false;
  const shape = capability.input.shape as Record<string, unknown>;
  return !projectFields.some((field) => field in shape);
}

// MCP clients send what the model wrote. Fields a tool does not take are
// refused rather than dropped, so a retry key or a misspelled field never
// silently does nothing.
function refuseUnknownFields(capability: AnyCapability, input: unknown) {
  if (!(capability.input instanceof z.ZodObject)) return;
  // Strict inputs (workspace commands) refuse with their own hints.
  if (capability.input._zod.def.catchall) return;
  if (!input || typeof input !== "object" || Array.isArray(input)) return;
  const shape = capability.input.shape as Record<string, unknown>;
  const unknown = Object.keys(input).filter((key) => !(key in shape));
  if (!unknown.length) return;
  const hint = unknown.includes("mutationId")
    ? " This tool takes no retry key: read the current state before calling it again."
    : "";
  throw new CapabilityError(
    "validation",
    `Unknown field(s): ${unknown.join(", ")}.${hint}`,
    {
      issues: unknown.map((key) => ({
        path: key,
        message: "Not a field of this tool.",
      })),
    },
  );
}

// People see work item keys (PAY-142) and agents copy them. Wherever an MCP
// tool takes `workItemId`, a key is accepted too and resolved among the
// organization's projects (every member reads every project); the domain
// services then authorize the id as usual.
const workItemKey = /^([A-Za-z][A-Za-z0-9]{1,9})-(\d+)$/;
async function resolveWorkItemKey(ctx: CapabilityContext, input: unknown) {
  if (!input || typeof input !== "object") return input;
  const fields = input as Record<string, unknown>;
  const reference = fields.workItemId;
  const organization = fields.organizationId;
  if (typeof reference !== "string" || typeof organization !== "string")
    return input;
  const match = workItemKey.exec(reference.trim());
  if (!match) return input;
  // An unknown organization is reported after validation, as for any call.
  const organizations = await organizationMatches(ctx, organization, true);
  if (organizations.length !== 1) return input;
  const organizationId = organizations[0]!.id;
  const [found] = await ctx.db
    .select({ id: s.workItem.id })
    .from(s.workItem)
    .innerJoin(
      s.project,
      and(
        eq(s.project.organizationId, s.workItem.organizationId),
        eq(s.project.id, s.workItem.projectId),
      ),
    )
    .where(
      and(
        eq(s.workItem.organizationId, organizationId),
        sql`upper(${s.project.key}) = ${match[1]!.toUpperCase()}`,
        eq(s.workItem.number, Number(match[2])),
      ),
    )
    .limit(1);
  if (!found)
    throw new CapabilityError(
      "not_found",
      `No work item in this organization has the key ${reference.trim().toUpperCase()}. workItemId takes a key such as PAY-142 or the item's id; listWorkItems shows both.`,
    );
  return { ...fields, workItemId: found.id };
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
  let failure: CapabilityError | null = null;
  try {
    if (!capability)
      throw (
        humanOnlyError(name) ??
        new CapabilityError("unavailable", `Unknown operation “${name}”.`)
      );
    // A person's decision is never an agent's, whatever its token allows
    // (docs/internals/software-factory.md, rule 3).
    if (capability.decision && ctx.principal.agent)
      throw personDecisionRefusal(capability, ctx.principal.agent.name);
    if (capability.kind === "command" && ctx.principal.access === "read")
      throw new CapabilityError(
        "forbidden",
        ctx.principal.agent
          ? `${ctx.principal.agent.name} is read only. Its owner can give it read and write access in Factory → Agents → ${ctx.principal.agent.name} → Edit → Scope.`
          : "This access token is read-only. Create a token with write access to make changes.",
      );
    let raw: unknown = rawInput ?? {};
    if (ctx.principal.surface === "mcp") {
      refuseUnknownFields(capability, raw);
      raw = await resolveWorkItemKey(ctx, raw);
    }
    const parsed = capability.input.parse(raw);
    const input =
      ctx.principal.surface === "mcp"
        ? await resolveMcpOrganization(ctx, parsed)
        : parsed;
    organizationId = organizationOf(input);
    await assertAgentScope(ctx, capability, input);
    // An organization that requires two-factor holds members without it,
    // and one scheduled for deletion holds everyone but its owners in the
    // few capabilities that allow it, on every surface, before any
    // capability runs (domain services check again through `authorize`).
    if (organizationId)
      await assertOrganizationAccess(
        ctx.db,
        ctx.principal.userId,
        organizationId,
        { owners: capability.whileDeletionScheduled === "owners" },
      );
    const output = await capability.run(ctx, input);
    if (output && typeof output === "object" && "mutationId" in output)
      mutationId = String(output.mutationId);
    return output;
  } catch (error) {
    const normalized = toCapabilityError(error);
    outcome = normalized.category;
    failure = normalized;
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
        detail: invocationDetail(rawInput, failure),
      });
  }
}
