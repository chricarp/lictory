import { createHash, randomBytes } from "node:crypto";
import { and, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import * as s from "@lictory/core/db/schema";
import { recordAuditEvent } from "@lictory/core/domain/audit";
import { DomainError } from "@lictory/core/domain/errors";
import {
  authorize,
  isAdmin,
  type Database,
  type Tx,
} from "@lictory/core/domain/service";
import { agentEntity } from "@lictory/core/factory/entities";
import { harnessIds, type HarnessId } from "@lictory/core/factory/protocol";
import {
  factoryWrite,
  present,
  projectAgent,
} from "@lictory/core/factory/store";
import { handleProblem, normalizeHandle } from "@lictory/core/lib/handles";

// Agents: named, non-human members of an organization with an accountable
// owner and a scope (docs/internals/factory.md#agents). Creating, changing
// and archiving agents are people's operations in the browser; agents read
// them like any other member.

type AgentRow = typeof s.agent.$inferSelect;

export type AgentInput = {
  name: string;
  handle: string;
  description?: string;
  avatar?: string | null;
  kind: "runner" | "external";
  harness?: HarnessId | null;
  model?: string | null;
  instructions?: string;
  access: "read" | "write";
  projectIds?: string[] | null;
  shared?: boolean;
  defaultRunnerId?: string | null;
};

function requireAgent<T>(row: T | undefined): T {
  if (!row) throw new DomainError("not_found", "This agent does not exist.");
  return row;
}

async function validate(
  tx: Tx,
  organizationId: string,
  input: Partial<AgentInput> & { kind?: AgentInput["kind"] },
  current?: AgentRow,
) {
  const kind = input.kind ?? (current?.kind as AgentInput["kind"]);
  const harness =
    input.harness === undefined ? current?.harness : input.harness;
  if (kind === "runner" && !harness)
    throw new DomainError(
      "validation",
      "Choose the harness that runs this agent on a runner.",
    );
  if (harness && !(harnessIds as readonly string[]).includes(harness))
    throw new DomainError("validation", "Unknown harness.");
  if (input.handle !== undefined) {
    const handle = normalizeHandle(input.handle);
    const problem = handleProblem(handle);
    if (problem) throw new DomainError("validation", problem);
    const [taken] = await tx
      .select({ id: s.agent.id })
      .from(s.agent)
      .where(
        and(
          eq(s.agent.organizationId, organizationId),
          eq(s.agent.handle, handle),
        ),
      );
    if (taken && taken.id !== current?.id)
      throw new DomainError(
        "validation",
        `Another agent is already @${handle}. Choose another handle.`,
      );
    // Mentions must not be ambiguous with a member of the organization.
    const [person] = await tx
      .select({ id: s.user.id })
      .from(s.member)
      .innerJoin(s.user, eq(s.user.id, s.member.userId))
      .where(
        and(
          eq(s.member.organizationId, organizationId),
          eq(s.user.handle, handle),
        ),
      );
    if (person)
      throw new DomainError(
        "validation",
        `A member of this organization is @${handle}. Choose another handle.`,
      );
  }
  if (input.projectIds?.length) {
    const found = await tx
      .select({ id: s.project.id })
      .from(s.project)
      .where(
        and(
          eq(s.project.organizationId, organizationId),
          inArray(s.project.id, input.projectIds),
        ),
      );
    if (found.length !== new Set(input.projectIds).size)
      throw new DomainError(
        "validation",
        "One of the chosen projects is unavailable.",
      );
  }
  if (input.defaultRunnerId) {
    const [found] = await tx
      .select({ id: s.runner.id })
      .from(s.runner)
      .where(
        and(
          eq(s.runner.organizationId, organizationId),
          eq(s.runner.id, input.defaultRunnerId),
          isNull(s.runner.revokedAt),
        ),
      );
    if (!found)
      throw new DomainError("validation", "That runner is unavailable.");
  }
}

const agentTarget = (row: AgentRow) => ({
  type: "agent",
  id: row.id,
  label: `@${row.handle}`,
});

export async function createAgent(
  db: Database,
  userId: string,
  organizationId: string,
  input: AgentInput,
  agentId: string = crypto.randomUUID(),
) {
  return factoryWrite(db, organizationId, async (tx) => {
    await authorize(tx, userId, organizationId);
    // A retried creation with the same id returns the agent it created.
    const [existing] = await tx
      .select()
      .from(s.agent)
      .where(
        and(
          eq(s.agent.organizationId, organizationId),
          eq(s.agent.id, agentId),
        ),
      );
    if (existing) {
      if (existing.ownerId !== userId)
        throw new DomainError("conflict", "This agent id is already used.");
      return agentEntity(existing);
    }
    await validate(tx, organizationId, input);
    const [row] = await tx
      .insert(s.agent)
      .values({
        id: agentId,
        organizationId,
        handle: normalizeHandle(input.handle),
        name: input.name.trim(),
        description: input.description?.trim() ?? "",
        avatar: input.avatar ?? null,
        // The person creating an agent is accountable for it.
        ownerId: userId,
        createdById: userId,
        kind: input.kind,
        harness: input.kind === "runner" ? (input.harness ?? null) : null,
        model: input.kind === "runner" ? present(input.model) : null,
        instructions: input.instructions?.trim() ?? "",
        access: input.access,
        projectIds: input.projectIds?.length ? input.projectIds : null,
        shared: input.shared ?? false,
        defaultRunnerId: input.defaultRunnerId ?? null,
      })
      .returning();
    await projectAgent(tx, row!);
    await recordAuditEvent(tx, {
      organizationId,
      actor: { id: userId },
      action: "agent.created",
      target: agentTarget(row!),
      detail: {
        kind: row!.kind,
        harness: row!.harness,
        access: row!.access,
        projectIds: row!.projectIds,
      },
    });
    return agentEntity(row!);
  });
}

async function lockAgent(tx: Tx, organizationId: string, agentId: string) {
  const [row] = await tx
    .select()
    .from(s.agent)
    .where(
      and(eq(s.agent.organizationId, organizationId), eq(s.agent.id, agentId)),
    )
    .for("update");
  return requireAgent(row);
}

// The owner changes an agent. Its scope can be narrowed or widened only
// within the owner's own authority, which every call checks anyway.
export async function updateAgent(
  db: Database,
  userId: string,
  organizationId: string,
  agentId: string,
  changes: Partial<Omit<AgentInput, "kind">>,
) {
  return factoryWrite(db, organizationId, async (tx) => {
    await authorize(tx, userId, organizationId);
    const current = await lockAgent(tx, organizationId, agentId);
    if (current.ownerId !== userId)
      throw new DomainError(
        "forbidden",
        "Only the agent's owner can change it.",
      );
    if (current.archivedAt)
      throw new DomainError(
        "conflict",
        "Restore this agent before changing it.",
      );
    await validate(tx, organizationId, changes, current);
    const [row] = await tx
      .update(s.agent)
      .set({
        ...(changes.name !== undefined && { name: changes.name.trim() }),
        ...(changes.handle !== undefined && {
          handle: normalizeHandle(changes.handle),
        }),
        ...(changes.description !== undefined && {
          description: changes.description.trim(),
        }),
        ...(changes.avatar !== undefined && { avatar: changes.avatar }),
        ...(changes.harness !== undefined &&
          current.kind === "runner" && { harness: changes.harness }),
        ...(changes.model !== undefined &&
          current.kind === "runner" && {
            model: present(changes.model),
          }),
        ...(changes.instructions !== undefined && {
          instructions: changes.instructions.trim(),
        }),
        ...(changes.access !== undefined && { access: changes.access }),
        ...(changes.projectIds !== undefined && {
          projectIds: changes.projectIds?.length ? changes.projectIds : null,
        }),
        ...(changes.shared !== undefined && { shared: changes.shared }),
        ...(changes.defaultRunnerId !== undefined && {
          defaultRunnerId: changes.defaultRunnerId,
        }),
        updatedAt: new Date(),
      })
      .where(eq(s.agent.id, agentId))
      .returning();
    await projectAgent(tx, row!);
    const scopeChanged =
      row!.access !== current.access ||
      JSON.stringify(row!.projectIds) !== JSON.stringify(current.projectIds) ||
      row!.shared !== current.shared;
    await recordAuditEvent(tx, {
      organizationId,
      actor: { id: userId },
      action: scopeChanged ? "agent.scope_changed" : "agent.updated",
      target: agentTarget(row!),
      detail: scopeChanged
        ? {
            access: { from: current.access, to: row!.access },
            projectIds: { from: current.projectIds, to: row!.projectIds },
            shared: { from: current.shared, to: row!.shared },
          }
        : {},
    });
    return agentEntity(row!);
  });
}

// Archiving stops every token of the agent and keeps its history. The
// owner or an organization administrator archives; restoring is the
// owner's (or an administrator's) too.
export async function setAgentArchived(
  db: Database,
  userId: string,
  organizationId: string,
  agentId: string,
  archived: boolean,
) {
  return factoryWrite(db, organizationId, async (tx) => {
    const membership = await authorize(tx, userId, organizationId);
    const current = await lockAgent(tx, organizationId, agentId);
    if (current.ownerId !== userId && !isAdmin(membership))
      throw new DomainError(
        "forbidden",
        "Only the agent's owner or an organization administrator can archive or restore it.",
      );
    if (Boolean(current.archivedAt) === archived) return agentEntity(current);
    const [row] = await tx
      .update(s.agent)
      .set({ archivedAt: archived ? new Date() : null, updatedAt: new Date() })
      .where(eq(s.agent.id, agentId))
      .returning();
    await projectAgent(tx, row!);
    await recordAuditEvent(tx, {
      organizationId,
      actor: { id: userId },
      action: archived ? "agent.archived" : "agent.restored",
      target: agentTarget(row!),
    });
    return agentEntity(row!);
  });
}

export async function listAgents(
  db: Database,
  userId: string,
  organizationId: string,
  options: { includeArchived?: boolean } = {},
) {
  await authorize(db, userId, organizationId);
  const rows = await db
    .select()
    .from(s.agent)
    .where(
      and(
        eq(s.agent.organizationId, organizationId),
        options.includeArchived ? undefined : isNull(s.agent.archivedAt),
      ),
    )
    .orderBy(s.agent.name);
  return rows.map(agentEntity);
}

// Resolves `@handle` to an agent of the organization (mentions in
// channels). Archived agents resolve too, flagged, so old messages still
// name them; callers decide whether an archived agent can be addressed.
export async function resolveAgentHandle(
  db: Database | Tx,
  organizationId: string,
  handle: string,
) {
  const normalized = normalizeHandle(handle);
  if (handleProblem(normalized)) return null;
  const [row] = await db
    .select()
    .from(s.agent)
    .where(
      and(
        eq(s.agent.organizationId, organizationId),
        eq(s.agent.handle, normalized),
      ),
    );
  if (!row) return null;
  return {
    id: row.id,
    handle: row.handle,
    name: row.name,
    ownerId: row.ownerId,
    kind: row.kind,
    archived: row.archivedAt !== null,
  };
}

// ------------------------------------------------------------ agent tokens

const TOKEN_PREFIX = "lct_";
const MAX_AGENT_TOKENS = 10;
const tokenHash = (secret: string) =>
  createHash("sha256").update(secret).digest("hex");

function tokenSummary(row: typeof s.accessToken.$inferSelect) {
  return {
    id: row.id,
    access: row.scope as "read" | "write",
    prefix: row.prefix,
    createdAt: row.createdAt.toISOString(),
    expiresAt: row.expiresAt?.toISOString() ?? null,
    lastUsedAt: row.lastUsedAt?.toISOString() ?? null,
    revokedAt: row.revokedAt?.toISOString() ?? null,
  };
}
export type AgentTokenSummary = ReturnType<typeof tokenSummary>;

async function ownedAgent(
  tx: Tx | Database,
  userId: string,
  organizationId: string,
  agentId: string,
) {
  const [row] = await tx
    .select()
    .from(s.agent)
    .where(
      and(eq(s.agent.organizationId, organizationId), eq(s.agent.id, agentId)),
    );
  const agent = requireAgent(row);
  if (agent.ownerId !== userId)
    throw new DomainError(
      "forbidden",
      "Only the agent's owner manages its access tokens.",
    );
  return agent;
}

// A token an external MCP client uses to act as this agent. The secret is
// returned once; only its hash is stored.
export async function createAgentToken(
  db: Database,
  userId: string,
  organizationId: string,
  input: { agentId: string; expiresInDays: number | null },
) {
  return factoryWrite(db, organizationId, async (tx) => {
    await authorize(tx, userId, organizationId);
    const agent = await ownedAgent(tx, userId, organizationId, input.agentId);
    if (agent.archivedAt)
      throw new DomainError("conflict", "Restore this agent first.");
    if (agent.kind === "intelligence")
      throw new DomainError(
        "validation",
        "Lictory Intelligence needs no access token.",
      );
    const [count] = await tx
      .select({ active: sql<number>`count(*)::int` })
      .from(s.accessToken)
      .where(
        and(
          eq(s.accessToken.agentId, agent.id),
          isNull(s.accessToken.agentSessionId),
          isNull(s.accessToken.revokedAt),
          sql`(${s.accessToken.expiresAt} is null or ${s.accessToken.expiresAt} > now())`,
        ),
      );
    if ((count?.active ?? 0) >= MAX_AGENT_TOKENS)
      throw new DomainError(
        "validation",
        `An agent can have at most ${MAX_AGENT_TOKENS} active tokens. Revoke one first.`,
      );
    const secret = TOKEN_PREFIX + randomBytes(32).toString("base64url");
    const [row] = await tx
      .insert(s.accessToken)
      .values({
        userId,
        name: agent.name,
        scope: agent.access,
        prefix: secret.slice(0, TOKEN_PREFIX.length + 6),
        tokenHash: tokenHash(secret),
        agentId: agent.id,
        expiresAt: input.expiresInDays
          ? new Date(Date.now() + input.expiresInDays * 86_400_000)
          : null,
      })
      .returning();
    await recordAuditEvent(tx, {
      organizationId,
      actor: { id: userId },
      action: "access_token.created",
      target: { type: "access_token", id: row!.id, label: `@${agent.handle}` },
      detail: {
        agentId: agent.id,
        access: row!.scope,
        prefix: row!.prefix,
        expiresAt: row!.expiresAt?.toISOString() ?? null,
      },
    });
    return { token: tokenSummary(row!), secret };
  });
}

export async function listAgentTokens(
  db: Database,
  userId: string,
  organizationId: string,
  agentId: string,
) {
  await authorize(db, userId, organizationId);
  await ownedAgent(db, userId, organizationId, agentId);
  const rows = await db
    .select()
    .from(s.accessToken)
    .where(
      and(
        eq(s.accessToken.agentId, agentId),
        // Session tokens come and go with sessions.
        isNull(s.accessToken.agentSessionId),
      ),
    )
    .orderBy(desc(s.accessToken.createdAt));
  return rows.map(tokenSummary);
}

export async function revokeAgentToken(
  db: Database,
  userId: string,
  organizationId: string,
  input: { agentId: string; tokenId: string },
) {
  return factoryWrite(db, organizationId, async (tx) => {
    await authorize(tx, userId, organizationId);
    const agent = await ownedAgent(tx, userId, organizationId, input.agentId);
    const [revoked] = await tx
      .update(s.accessToken)
      .set({ revokedAt: new Date() })
      .where(
        and(
          eq(s.accessToken.id, input.tokenId),
          eq(s.accessToken.agentId, agent.id),
          isNull(s.accessToken.revokedAt),
        ),
      )
      .returning();
    if (revoked)
      await recordAuditEvent(tx, {
        organizationId,
        actor: { id: userId },
        action: "access_token.revoked",
        target: {
          type: "access_token",
          id: revoked.id,
          label: `@${agent.handle}`,
        },
        detail: { agentId: agent.id, prefix: revoked.prefix },
      });
    const [row] = await tx
      .select()
      .from(s.accessToken)
      .where(
        and(
          eq(s.accessToken.id, input.tokenId),
          eq(s.accessToken.agentId, agent.id),
        ),
      );
    if (!row) throw new DomainError("not_found", "This token does not exist.");
    return tokenSummary(row);
  });
}
